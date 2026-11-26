"""
=============================================================================
NLP333: HỆ THỐNG RÀ SOÁT HỢP ĐỒNG THUÊ NHÀ & LAO ĐỘNG THÔNG MINH
Backend FastAPI Serverless Endpoint phục vụ triển khai trên Vercel
Tệp: api/index.py
=============================================================================
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import Optional, List, Dict, Any, Literal

# =============================================================================
# 1. THIẾT LẬP ĐƯỜNG DẪN THƯ MỤC DỰ ÁN & MÔI TRƯỜNG SERVERLESS
# =============================================================================
# Định vị thư mục gốc dự án (cloud_vercel)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Đưa PROJECT_ROOT vào sys.path để import an toàn các module trong src/
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Định vị thư mục data (chuẩn xác cho cả chạy local và runtime Vercel)
DATA_DIR = PROJECT_ROOT / "data"
if not DATA_DIR.exists():
    alt_data = Path("data").resolve()
    if alt_data.exists():
        DATA_DIR = alt_data

# Tải biến môi trường từ file .env nếu có
try:
    from dotenv import load_dotenv
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    pass

# =============================================================================
# 2. IMPORT CÁC MODULE XỬ LÝ NỘI BỘ TỪ SRC/
# =============================================================================
from src.ingestion.router import route_document
from src.segmentation.clause_segmenter import ClauseSegmenter
from src.retrieval.legal_kb import LegalKnowledgeBase
from src.agents.risk_analyzer_agent import RiskAnalyzerAgent
from src.agents.reflection_critic import ReflectionCritic
from src.agents.proposal_agent import ProposalAgent
from src.hitl.document_assembler import DocumentAssembler
from src.agents.schemas import (
    RiskAnalysisResult,
    ContractReviewPackage,
    RedlineProposal,
)

# =============================================================================
# 3. KHỞI TẠO FASTAPI & CẤU HÌNH CORSMiddleware
# =============================================================================
from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(
    title="NLP333 - LegalTech AI Backend API",
    description="Hệ thống rà soát và đàm phán hợp đồng tiếng Việt (Multi-Agent Legal AI)",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# Middleware xử lý định tuyến cho Vercel Serverless Function
@app.middleware("http")
async def vercel_routing_middleware(request: Request, call_next):
    # Khôi phục path thực tế từ query parameter __route__ do vercel.json chuyển tiếp
    route_param = request.query_params.get("__route__")
    if route_param:
        clean_path = route_param.strip("/")
        if not clean_path.startswith("api/"):
            request.scope["path"] = f"/api/{clean_path}"
        else:
            request.scope["path"] = f"/{clean_path}"

    response = await call_next(request)
    return response

# Kích hoạt CORS hỗ trợ tất cả các domain frontend kết nối
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router chính quản lý các endpoint
api_router = APIRouter()

# =============================================================================
# 4. PYDANTIC SCHEMAS CHO CÁC REQUEST / RESPONSE
# =============================================================================

class AnalyzeRequest(BaseModel):
    contract_text: str = Field(..., description="Toàn văn hợp đồng cần rà soát")
    contract_type: Literal["rental", "employment"] = Field(
        "rental", description="Loại hợp đồng: 'rental' (thuê nhà) hoặc 'employment' (lao động)"
    )
    perspective: Literal["party_b", "party_a", "neutral"] = Field(
        "party_b", description="Góc nhìn rà soát: 'party_b' (bên yếu thế), 'party_a', hoặc 'neutral'"
    )


class ProposalReviewItem(BaseModel):
    proposal_id: str = Field(..., description="Mã định danh đề xuất sửa đổi")
    hitl_status: Literal["APPROVED", "MODIFIED", "REJECTED", "PENDING"] = Field(
        "APPROVED", description="Trạng thái thẩm định: APPROVED, MODIFIED, REJECTED, PENDING"
    )
    custom_clause: Optional[str] = Field(None, description="Câu văn tự soạn nếu người dùng chọn MODIFIED")
    original_clause: Optional[str] = Field(None, description="Câu văn gốc vi phạm trong hợp đồng")
    proposed_clause: Optional[str] = Field(None, description="Câu văn chuẩn mực đề xuất thay thế")


class AssembleRequest(BaseModel):
    original_contract_text: str = Field(..., description="Văn bản gốc hợp đồng")
    proposals: List[ProposalReviewItem] = Field(
        default_factory=list, description="Danh sách các điều khoản đã được duyệt/sửa đổi bởi người dùng"
    )


# =============================================================================
# 5. ĐỊNH NGHĨA CÁC ENDPOINT RÕ RÀNG
# =============================================================================

@api_router.get("/health", summary="Kiểm tra trạng thái dịch vụ & cấu hình môi trường")
def check_health(request: Request):
    """
    Kiểm tra trạng thái sẵn sàng của dịch vụ, thư mục data và các biến môi trường LLM API.
    """
    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    active_provider = "None (Rule-based Fallback Active)"
    if openrouter_key:
        active_provider = "OpenRouter"
    elif openai_key:
        active_provider = "OpenAI"
    elif gemini_key:
        active_provider = "Google Gemini"
    elif groq_key:
        active_provider = "Groq"

    rental_rules_exist = (DATA_DIR / "legal_rules.json").exists()
    employment_rules_exist = (DATA_DIR / "legal_rules_employment.json").exists()

    debug_info = {}
    if request:
        debug_info = {
            "headers": dict(request.headers),
            "scope_path": request.scope.get("path", ""),
            "scope_root_path": request.scope.get("root_path", ""),
            "scope_raw_path": str(request.scope.get("raw_path", b"")),
            "scope_query": request.scope.get("query_string", b"").decode("utf-8", errors="ignore"),
        }

    return {
        "status": "healthy",
        "service": "NLP333 LegalTech API (Vercel Serverless)",
        "timestamp": time.time(),
        "paths": {
            "project_root": str(PROJECT_ROOT),
            "data_dir": str(DATA_DIR),
            "data_dir_exists": DATA_DIR.exists(),
            "legal_rules_rental": rental_rules_exist,
            "legal_rules_employment": employment_rules_exist,
        },
        "llm_configuration": {
            "active_provider": active_provider,
            "has_api_key": bool(openrouter_key or openai_key or gemini_key or groq_key),
            "configured_model": os.getenv("OPENROUTER_MODEL") or os.getenv("LLM_MODEL") or "google/gemini-2.5-flash",
            "rule_based_fallback_ready": True
        },
        "debug": debug_info
    }


@api_router.get("/samples", summary="Liệt kê danh sách mẫu hợp đồng có sẵn")
def list_samples(category: Optional[str] = None):
    """
    Liệt kê danh sách hợp đồng mẫu từ data/contracts và data/contracts_employment để chọn nhanh.
    Hỗ trợ lọc qua query param: ?category=rental hoặc ?category=employment
    """
    rental_dir = DATA_DIR / "contracts"
    employment_dir = DATA_DIR / "contracts_employment"

    samples: Dict[str, List[Dict[str, Any]]] = {
        "rental": [],
        "employment": []
    }

    if rental_dir.exists():
        for f in sorted(rental_dir.glob("*.txt")):
            samples["rental"].append({
                "id": f.name,
                "name": f.stem.replace("_", " "),
                "category": "rental",
                "size_bytes": f.stat().st_size
            })

    if employment_dir.exists():
        for f in sorted(employment_dir.glob("*.txt")):
            samples["employment"].append({
                "id": f.name,
                "name": f.stem.replace("_", " "),
                "category": "employment",
                "size_bytes": f.stat().st_size
            })

    if category == "rental":
        return {"category": "rental", "total": len(samples["rental"]), "samples": samples["rental"]}
    elif category == "employment":
        return {"category": "employment", "total": len(samples["employment"]), "samples": samples["employment"]}

    return {
        "total_rental": len(samples["rental"]),
        "total_employment": len(samples["employment"]),
        "samples": samples
    }


@api_router.get("/samples/{category}/{filename}", summary="Đọc nội dung chi tiết một mẫu hợp đồng")
def get_sample_content(category: str, filename: str):
    """
    Trả về toàn văn nội dung một hợp đồng mẫu cụ thể.
    """
    folder = "contracts" if category == "rental" else "contracts_employment"
    target_path = DATA_DIR / folder / filename

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy mẫu hợp đồng: {category}/{filename}"
        )

    try:
        content = target_path.read_text(encoding="utf-8", errors="replace")
        return {
            "filename": filename,
            "category": category,
            "character_count": len(content),
            "content": content
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi đọc file mẫu hợp đồng: {str(e)}"
        )


@api_router.get("/rules", summary="Lấy danh mục quy tắc pháp lý kiểm tra")
def get_rules(contract_type: Optional[str] = None):
    """
    Đọc và trả về danh sách các quy tắc từ data/legal_rules.json và data/legal_rules_employment.json.
    Query param: ?contract_type=rental hoặc ?contract_type=employment
    """
    rental_file = DATA_DIR / "legal_rules.json"
    employment_file = DATA_DIR / "legal_rules_employment.json"

    result: Dict[str, Any] = {}

    if contract_type in [None, "rental"]:
        if rental_file.exists():
            try:
                with open(rental_file, "r", encoding="utf-8") as f:
                    result["rental"] = json.load(f)
            except Exception as e:
                result["rental"] = {"error": f"Không thể đọc file quy tắc thuê nhà: {str(e)}"}
        else:
            result["rental"] = {"error": "Tệp legal_rules.json không tồn tại trong data/"}

    if contract_type in [None, "employment"]:
        if employment_file.exists():
            try:
                with open(employment_file, "r", encoding="utf-8") as f:
                    result["employment"] = json.load(f)
            except Exception as e:
                result["employment"] = {"error": f"Không thể đọc file quy tắc lao động: {str(e)}"}
        else:
            result["employment"] = {"error": "Tệp legal_rules_employment.json không tồn tại trong data/"}

    if contract_type == "rental":
        return result.get("rental", {})
    elif contract_type == "employment":
        return result.get("employment", {})

    return result


@api_router.post("/ocr", summary="Bóc tách văn bản hợp đồng từ tệp (tối đa 7 tệp/ảnh) hoặc văn bản thô")
async def extract_contract_text(
    request: Request,
    file: Optional[UploadFile] = File(None),
    files: Optional[List[UploadFile]] = File(None),
    text: Optional[str] = Form(None)
):
    """
    Nhận tệp tải lên (hỗ trợ tối đa 7 ảnh chụp/PDF/Word/TXT) hoặc chuỗi văn bản,
    chạy qua Smart Ingestion Router và tự động ghép nối thành văn bản hoàn chỉnh.
    """
    extracted_text = ""
    source_filename = "direct_input.txt"

    try:
        raw_files: List[UploadFile] = []
        if isinstance(files, list):
            raw_files.extend(files)
        elif hasattr(files, "filename") and getattr(files, "filename", None):
            raw_files.append(files)

        if hasattr(file, "filename") and getattr(file, "filename", None) and file not in raw_files:
            raw_files.append(file)

        form_text = ""
        if isinstance(text, str) and text.strip():
            form_text = text.strip()

        # Quét thêm danh sách file từ form multipart
        try:
            form = await request.form()
            for key in ["files", "file"]:
                for item in form.getlist(key):
                    if hasattr(item, "filename") and getattr(item, "filename", None) and item not in raw_files:
                        raw_files.append(item)
            if not form_text and "text" in form:
                val = form["text"]
                if isinstance(val, str) and val.strip():
                    form_text = val.strip()
        except Exception:
            pass

        # 1. Xử lý danh sách tệp tải lên (tối đa 7 tệp)
        if raw_files:
            active_files = raw_files[:7]
            extracted_docs = []
            valid_names = []

            for idx, f in enumerate(active_files, 1):
                file_bytes = await f.read()
                if not file_bytes:
                    continue
                doc_text = route_document(file_bytes, filename=f.filename)
                if doc_text and not doc_text.strip().startswith("[CẢNH BÁO ĐỊNH DẠNG]"):
                    if len(active_files) > 1:
                        extracted_docs.append(f"=== [TÀI LIỆU / PHỤ LỤC {idx}: {f.filename}] ===\n{doc_text}")
                    else:
                        extracted_docs.append(doc_text)
                    valid_names.append(f.filename)
                elif doc_text:
                    extracted_docs.append(f"=== [TÀI LIỆU {idx}: {f.filename}] ===\n{doc_text}")
                    valid_names.append(f.filename)

            extracted_text = "\n\n".join(extracted_docs).strip()
            source_filename = ", ".join(valid_names) if valid_names else "uploaded_files"

        # 2. Nhận từ form field 'text'
        elif form_text:
            extracted_text = form_text

        # 3. Nhận từ raw JSON payload
        else:
            try:
                body = await request.json()
                extracted_text = body.get("text", "").strip()
                source_filename = body.get("filename", "json_payload.txt")
            except Exception:
                pass

        if not extracted_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Vui lòng tải lên tệp hợp đồng (.docx, .pdf, ảnh, .txt) hoặc truyền chuỗi văn bản."
            )

        is_warning = extracted_text.startswith("[CẢNH BÁO") or extracted_text.startswith("[LỖI")

        # Thống kê cơ bản
        lines = extracted_text.splitlines()
        words = extracted_text.split()
        clauses_count = 0
        try:
            segmenter = ClauseSegmenter()
            clauses = segmenter.segment(extracted_text)
            clauses_count = len(clauses)
        except Exception:
            pass

        return {
            "status": "warning" if is_warning else "success",
            "filename": source_filename,
            "text": extracted_text,
            "stats": {
                "character_count": len(extracted_text),
                "word_count": len(words),
                "line_count": len(lines),
                "detected_clauses": clauses_count
            },
            "is_warning": is_warning
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi trong quá trình bóc tách tài liệu: {str(e)}"
        )


@api_router.post("/analyze", summary="Rà soát rủi ro pháp lý & Đề xuất Redlining")
def analyze_contract(req: AnalyzeRequest):
    """
    Rà soát rủi ro hợp đồng tiếng Việt trọn vẹn:
    1. Clause Segmenter: Tách các điều khoản
    2. Risk Analyzer Agent: Đối soát KB & NLI (kèm fallback rule-based tự động khi thiếu API Key)
    3. Reflection Critic: Khử báo động giả & khử trùng lặp
    4. Proposal Agent: Tính điểm an toàn, phán quyết & tạo đề xuất Redline 3 bước
    """
    contract_text = req.contract_text.strip()
    if not contract_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Văn bản hợp đồng không được để trống."
        )

    t0 = time.time()
    domain = req.contract_type
    perspective = req.perspective
    is_fallback = False
    warning_note = None

    try:
        # Bước 1: Phân tách điều khoản
        segmenter = ClauseSegmenter()
        clauses = segmenter.segment(contract_text)

        # Bước 2: Phân tích rủi ro (kèm fallback an toàn không làm sập server)
        analyzer = RiskAnalyzerAgent(contract_type=domain)
        try:
            raw_risks = analyzer.analyze(contract_text, contract_type=domain, perspective=perspective)
        except Exception as e:
            is_fallback = True
            warning_note = f"Hệ thống tự động kích hoạt Rule-based Fallback do: {str(e)}"
            raw_risks = analyzer._rule_based_fallback_analyze(contract_text)

        # Bước 3: Phản biện tự động để khử False Alarm (Reflection Critic)
        critic = ReflectionCritic()
        refined_risks = critic.critique_and_refine(contract_text, raw_risks)

        # Bước 4: Soạn thảo Redlining và kịch bản đàm phán (Proposal Agent)
        proposer = ProposalAgent(contract_type=domain)
        package = proposer.formulate_proposals(contract_text, refined_risks, perspective=perspective)

        elapsed = round(time.time() - t0, 3)

        # Chuẩn hóa danh sách đề xuất thành JSON có cấu trúc rõ ràng
        formatted_proposals = []
        for p in package.proposals:
            formatted_proposals.append({
                "proposal_id": p.proposal_id,
                "rule_id": p.rule_id,
                "rule_name": p.rule_name,
                "risk_level": p.risk_level,
                "related_article": p.related_article,
                "original_clause": p.original_clause,
                "proposed_clause": p.proposed_clause,
                "statutory_citation": p.statutory_citation,
                "reference_url": p.reference_url,
                "negotiation_script": p.negotiation_script,
                "compromise_option": p.compromise_option,
                "hitl_status": p.hitl_status
            })

        return {
            "status": "success",
            "contract_type": domain,
            "perspective": perspective,
            "elapsed_seconds": elapsed,
            "is_fallback": is_fallback,
            "warning_note": warning_note,
            "safety_score": package.safety_score,
            "verdict": package.verdict,
            "executive_summary": package.executive_summary,
            "total_risks_found": package.total_risks_found,
            "red_risks_count": sum(1 for p in package.proposals if p.risk_level == "RED"),
            "yellow_risks_count": sum(1 for p in package.proposals if p.risk_level == "YELLOW"),
            "clauses_count": len(clauses),
            "proposals": formatted_proposals
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi trong quá trình rà soát hợp đồng: {str(e)}"
        )


@api_router.post("/assemble", summary="Lắp ráp hợp đồng hoàn thiện sau khi thẩm định HITL")
def assemble_contract(req: AssembleRequest):
    """
    Tái cấu trúc và lắp ráp hợp đồng hoàn chỉnh sau khi con người thẩm định (Human-in-the-Loop).
    Thay thế các điều khoản APPROVED hoặc MODIFIED vào văn bản gốc, bảo toàn cấu trúc văn bản.
    """
    original_text = req.original_contract_text
    if not original_text or not original_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Văn bản gốc hợp đồng không được để trống."
        )

    try:
        # Chuẩn hóa danh sách đề xuất để đưa vào DocumentAssembler
        proposals_objs = []
        for p in req.proposals:
            status_val = p.hitl_status.upper().strip()
            final_clause_val = None
            if status_val == "APPROVED":
                final_clause_val = p.proposed_clause
            elif status_val == "MODIFIED":
                final_clause_val = p.custom_clause or p.proposed_clause
            elif status_val == "REJECTED":
                final_clause_val = p.original_clause

            proposals_objs.append(
                RedlineProposal(
                    proposal_id=p.proposal_id,
                    rule_id="RULE_HITL",
                    rule_name="Điều khoản thẩm định HITL",
                    risk_level="INFO",
                    original_clause=p.original_clause or "",
                    proposed_clause=p.proposed_clause or "",
                    statutory_citation="",
                    negotiation_script="",
                    hitl_status=status_val,
                    user_custom_clause=p.custom_clause,
                    final_clause=final_clause_val
                )
            )

        mock_pkg = ContractReviewPackage(
            executive_summary="HITL Final Assembled Contract",
            verdict="COMPLETED",
            safety_score=10.0,
            total_risks_found=len(proposals_objs),
            proposals=proposals_objs,
            is_hitl_completed=True
        )

        final_contract_text = DocumentAssembler.assemble_final_contract(original_text, mock_pkg)
        applied_count = sum(1 for p in req.proposals if p.hitl_status.upper() in ["APPROVED", "MODIFIED"])

        return {
            "status": "success",
            "applied_changes_count": applied_count,
            "total_proposals": len(req.proposals),
            "final_contract_text": final_contract_text
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi lắp ráp hợp đồng hoàn thiện: {str(e)}"
        )


# =============================================================================
# 6. ĐĂNG KÝ ROUTER ĐỒNG THỜI VỚI VÀ KHÔNG CÓ TIỀN TỐ /api (HỖ TRỢ MỌI CẤU HÌNH VERCEL)
# =============================================================================
app.include_router(api_router, prefix="/api")
app.include_router(api_router, prefix="")

@app.get("/", summary="Trang chủ API")
def root_endpoint():
    return {
        "service": "NLP333 Multi-Agent Legal AI API",
        "description": "API rà soát & đàm phán hợp đồng tiếng Việt cho Vercel Cloud",
        "status": "online",
        "documentation": "/api/docs",
        "health_check": "/api/health"
    }

@app.api_route("/api/index.py", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], include_in_schema=False)
async def direct_index_py_handler(request: Request):
    """
    Dispatcher đa năng xử lý mọi request khi Vercel rewrite về /api/index.py
    """
    route_name = (request.query_params.get("__route__") or "").strip("/")

    if route_name == "health":
        return check_health(request)
    elif route_name == "samples":
        return list_samples(category=request.query_params.get("category"))
    elif route_name.startswith("samples/"):
        parts = route_name.split("/")
        if len(parts) >= 3:
            return get_sample_content(parts[1], parts[2])
    elif route_name == "rules":
        return get_rules(contract_type=request.query_params.get("contract_type"))
    elif route_name == "ocr" and request.method == "POST":
        return await extract_contract_text(request)
    elif route_name == "analyze" and request.method == "POST":
        body = await request.json()
        return await analyze_contract(AnalyzeRequest(**body))
    elif route_name == "assemble" and request.method == "POST":
        body = await request.json()
        return await assemble_contract(AssembleRequest(**body))

    return check_health(request)


# Cho phép chạy kiểm thử trực tiếp: python api/index.py
if __name__ == "__main__":
    import uvicorn
    print(f"🚀 Đang khởi động NLP333 FastAPI Server tại http://localhost:8000 ...")
    uvicorn.run("api.index:app", host="0.0.0.0", port=8000, reload=True)
