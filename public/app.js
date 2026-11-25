/**
 * NLP333 LegalTech AI - Client-side Application (Vercel Cloud)
 * Rà soát hợp đồng, duyệt HITL, tra cứu pháp luật và lắp ráp hợp đồng hoàn thiện
 */

document.addEventListener("DOMContentLoaded", () => {
  // =========================================================================
  // 1. CẤU HÌNH & TRẠNG THÁI TOÀN CỤC (GLOBAL STATE)
  // =========================================================================
  const API_BASE = "/api"; // Đường dẫn tương đối chuẩn cho Vercel & Localhost

  const state = {
    contractText: "",
    contractType: "rental",
    perspective: "party_b",
    proposals: [],
    rules: { rental: [], employment: [] },
    isApiOnline: false,
    finalAssembledText: ""
  };

  // =========================================================================
  // 2. DỮ LIỆU DỰ PHÒNG NGOẠI TUYẾN (CLIENT-SIDE OFFLINE FALLBACK DATA)
  // Đảm bảo giao diện luôn mở xem và tương tác mượt kể cả khi chưa có API key
  // =========================================================================
  const FALLBACK_SAMPLES = {
    "HD_001.txt": {
      name: "Hợp đồng thuê phòng trọ (Mẫu thực tế có bẫy cọc & tăng giá)",
      category: "rental",
      text: `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
-----------------------------
HỢP ĐỒNG THUÊ PHÒNG TRỌ

Bên A (Bên cho thuê): Ông Nguyễn Văn A - CMND: 001090012345
Bên B (Bên thuê): Bạn Trần Văn B - CCCD: 025200009876

Hai bên thống nhất các điều khoản sau:
Điều 1: Tiền thuê phòng trọ là 3.500.000 VNĐ/tháng. Đóng tiền vào ngày 05 hàng tháng.
Điều 2: Tiền đặt cọc là 7.000.000 VNĐ (tương đương 02 tháng tiền nhà).
Điều 3: Nếu Bên B chấm dứt hợp đồng trước thời hạn vì bất kỳ lý do gì đều bị mất toàn bộ tiền đặt cọc và bồi thường thêm 01 tháng tiền nhà.
Điều 4: Bên A có quyền đơn phương tăng giá thuê nhà bất cứ lúc nào nếu thấy giá cả thị trường biến động mà không cần sự đồng ý của Bên B.
Điều 5: Bên A được phép tự ý mở khóa vào kiểm tra phòng trọ bất cứ lúc nào mà không cần báo trước cho Bên B để bảo đảm trật tự.
Điều 6: Tiền điện tính 5.000 đ/kWh, tiền nước tính 40.000 đ/người/tháng.`
    },
    "HD_LD_001.txt": {
      name: "Hợp đồng thử việc & lao động (Mẫu có bẫy giữ bằng gốc & lương <85%)",
      category: "employment",
      text: `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
-----------------------------
HỢP ĐỒNG THỬ VIỆC VÀ NGUYÊN TẮC LAO ĐỘNG

Người sử dụng lao động (Bên A): Công ty Cổ phần Công nghệ ABC
Người lao động (Bên B): Anh Lê Văn C - Kỹ sư phần mềm

Hai bên cùng thỏa thuận ký kết hợp đồng với các điều khoản:
Điều 1: Vị trí đảm nhận: Lập trình viên Backend. Thời gian thử việc là 90 ngày.
Điều 2: Lương thử việc bằng 70% mức lương chính thức (Lương chính thức: 15.000.000 VNĐ, lương thử việc: 10.500.000 VNĐ).
Điều 3: Để bảo đảm trách nhiệm làm việc, Bên B phải nộp bản chính Giấy tờ tùy thân (CCCD) và bản gốc Bằng tốt nghiệp Đại học cho Công ty giữ trong thời gian hợp đồng.
Điều 4: Bên B cam kết không được làm việc cho bất kỳ công ty nào cùng ngành công nghệ thông tin trong vòng 03 năm kể từ ngày thôi việc, nếu vi phạm bồi thường 100.000.000 VNĐ.
Điều 5: Trong thời gian thử việc, hai bên thống nhất không tham gia đóng Bảo hiểm xã hội và Bảo hiểm y tế bắt buộc.`
    }
  };

  const FALLBACK_RULES = [
    {
      rule_id: "RULE_DEPOSIT_NON_REFUNDABLE",
      rule_name: "Tịch thu toàn bộ tiền cọc vô điều kiện khi chấm dứt hợp đồng",
      category: "Đặt cọc & Hoàn cọc",
      risk_level: "RED",
      legal_basis: "Điều 328 Bộ luật Dân sự 2015",
      trigger_condition: "Quy định mất 100% tiền cọc dù đã báo trước hợp lệ hoặc do lỗi bên cho thuê.",
      suggested_clause: "Nếu Bên B báo trước tối thiểu 30 ngày, Bên A hoàn trả 50% tiền cọc (hoặc 100% nếu tìm được người thay thế).",
      keywords: ["mất cọc", "mất toàn bộ tiền cọc", "không được hoàn lại tiền cọc", "tịch thu cọc"]
    },
    {
      rule_id: "RULE_ARBITRARY_RENT_INCREASE",
      rule_name: "Tự ý tăng giá thuê bất hợp lý giữa thời hạn",
      category: "Giá thuê & Thanh toán",
      risk_level: "YELLOW",
      legal_basis: "Khoản 2 Điều 132 Luật Nhà ở 2023 & Điều 473 BLDS 2015",
      trigger_condition: "Bên cho thuê tự ý tăng giá mà không cần thỏa thuận hoặc không báo trước.",
      suggested_clause: "Giá thuê nhà được giữ ổn định trong suốt thời hạn hợp đồng. Mọi điều chỉnh giá phải được hai bên thỏa thuận bằng văn bản.",
      keywords: ["tăng giá thuê bất cứ lúc nào", "tự ý tăng giá", "điều chỉnh giá thuê"]
    },
    {
      rule_id: "RULE_INVASION_OF_PRIVACY",
      rule_name: "Xâm phạm quyền bất khả xâm phạm về chỗ ở",
      category: "Quyền riêng tư chỗ ở",
      risk_level: "RED",
      legal_basis: "Điều 22 Hiến pháp 2013 & Điều 10 Luật Nhà ở 2023",
      trigger_condition: "Bên cho thuê tự ý vào phòng trọ kiểm tra bất cứ lúc nào mà không báo trước.",
      suggested_clause: "Bên A chỉ được vào kiểm tra phòng khi có sự đồng ý của Bên B và phải báo trước tối thiểu 24 giờ (trừ sự cố khẩn cấp).",
      keywords: ["vào kiểm tra phòng bất cứ lúc nào", "không cần báo trước", "tự ý mở khóa"]
    },
    {
      rule_id: "RULE_LABOR_RETAIN_PAPERS",
      rule_name: "Giữ bản chính giấy tờ tùy thân, văn bằng gốc của người lao động",
      category: "Hồ sơ & Tuyển dụng",
      risk_level: "RED",
      legal_basis: "Khoản 1 Điều 17 Bộ luật Lao động 2019",
      trigger_condition: "Bắt nộp bản gốc CCCD/CMND, bằng tốt nghiệp gốc để công ty lưu giữ.",
      suggested_clause: "Người lao động chỉ xuất trình bản chính để đối chiếu hoặc nộp bản sao có chứng thực.",
      keywords: ["giữ bản chính", "nộp bằng gốc", "giữ cccd", "giữ bằng tốt nghiệp"]
    },
    {
      rule_id: "RULE_LABOR_PROBATION_SALARY_BELOW_85",
      rule_name: "Mức lương thử việc thấp hơn 85% mức lương chính thức",
      category: "Tiền lương thử việc",
      risk_level: "RED",
      legal_basis: "Điều 26 Bộ luật Lao động 2019",
      trigger_condition: "Tiền lương trong thời gian thử việc thấp hơn 85% lương của công việc đó.",
      suggested_clause: "Tiền lương thử việc của Bên B bằng 85% mức lương chính thức theo đúng Điều 26 BLLĐ 2019.",
      keywords: ["70% mức lương", "80% mức lương", "thử việc hưởng 70%", "thử việc hưởng 80%"]
    },
    {
      rule_id: "RULE_LABOR_EVADE_SOCIAL_INSURANCE",
      rule_name: "Thỏa thuận không tham gia hoặc trốn đóng BHXH, BHYT bắt buộc",
      category: "Bảo hiểm xã hội",
      risk_level: "RED",
      legal_basis: "Điều 168 Bộ luật Lao động 2019 & Luật BHXH",
      trigger_condition: "Điều khoản từ chối đóng BHXH bắt buộc hoặc thỏa thuận tự đóng.",
      suggested_clause: "Người sử dụng lao động và người lao động có trách nhiệm tham gia đóng BHXH, BHYT, BHTN theo đúng quy định pháp luật.",
      keywords: ["không tham gia đóng bảo hiểm", "không đóng bhxh", "không đóng bảo hiểm xã hội"]
    }
  ];

  // =========================================================================
  // 3. KHỞI TẠO TAB & ĐIỀU HƯỚNG GIAO DIỆN
  // =========================================================================
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      tabButtons.forEach(b => b.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add("active");
    });
  });

  // =========================================================================
  // 4. KIỂM TRA SỨC KHỎE API (HEALTH CHECK)
  // =========================================================================
  async function checkApiHealth() {
    const badge = document.getElementById("api-status-badge");
    const text = document.getElementById("api-status-text");
    const dot = badge ? badge.querySelector(".status-dot") : null;

    const urls = [`${API_BASE}/health`, "/health"];
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          if (data && data.status === "healthy") {
            state.isApiOnline = true;
            if (text) text.textContent = "API: Sẵn sàng (FastAPI sin1)";
            if (dot) dot.className = "status-dot online";
            return;
          }
        }
      } catch (err) {
        // Tiếp tục thử URL dự phòng
      }
    }

    state.isApiOnline = false;
    if (text) text.textContent = "API: Offline (Client Fallback Ready)";
    if (dot) dot.className = "status-dot offline";
  }

  // =========================================================================
  // 5. NẠP DANH SÁCH MẪU HỢP ĐỒNG (SAMPLES PICKER)
  // =========================================================================
  async function loadSamples() {
    const select = document.getElementById("sample-select");
    if (!select) return;

    select.innerHTML = '<option value="">-- Chọn hợp đồng mẫu thử nghiệm --</option>';

    try {
      if (state.isApiOnline) {
        const res = await fetch(`${API_BASE}/samples`);
        if (res.ok) {
          const data = await res.json();
          const samples = data.samples || {};

          if (samples.rental && samples.rental.length) {
            const grpRental = document.createElement("optgroup");
            grpRental.label = "🏠 Hợp đồng Thuê nhà";
            samples.rental.slice(0, 8).forEach(s => {
              const opt = document.createElement("option");
              opt.value = `rental:${s.id}`;
              opt.textContent = `${s.id} - ${s.name}`;
              grpRental.appendChild(opt);
            });
            select.appendChild(grpRental);
          }

          if (samples.employment && samples.employment.length) {
            const grpEmp = document.createElement("optgroup");
            grpEmp.label = "💼 Hợp đồng Lao động";
            samples.employment.forEach(s => {
              const opt = document.createElement("option");
              opt.value = `employment:${s.id}`;
              opt.textContent = `${s.id} - ${s.name}`;
              grpEmp.appendChild(opt);
            });
            select.appendChild(grpEmp);
          }
          return;
        }
      }
    } catch (e) {
      console.log("Dùng mẫu fallback cục bộ.");
    }

    // Fallback: Nếu API offline
    const grpFallback = document.createElement("optgroup");
    grpFallback.label = "🌟 Mẫu thử nghiệm tích hợp sẵn (Offline)";
    for (const [key, val] of Object.entries(FALLBACK_SAMPLES)) {
      const opt = document.createElement("option");
      opt.value = `fallback:${key}`;
      opt.textContent = `${key} - ${val.name}`;
      grpFallback.appendChild(opt);
    }
    select.appendChild(grpFallback);
  }

  // Xử lý khi người dùng chọn mẫu hợp đồng
  const sampleSelect = document.getElementById("sample-select");
  if (sampleSelect) {
    sampleSelect.addEventListener("change", async (e) => {
      const val = e.target.value;
      if (!val) return;

      const textarea = document.getElementById("contract-text");
      const contractTypeSelect = document.getElementById("contract-type-select");

      if (val.startsWith("fallback:")) {
        const key = val.replace("fallback:", "");
        const sample = FALLBACK_SAMPLES[key];
        if (sample && textarea) {
          textarea.value = sample.text;
          if (contractTypeSelect) contractTypeSelect.value = sample.category;
          updateTextStats();
        }
        return;
      }

      const [category, filename] = val.split(":");
      try {
        const res = await fetch(`${API_BASE}/samples/${category}/${filename}`);
        if (res.ok) {
          const data = await res.json();
          if (textarea) textarea.value = data.content;
          if (contractTypeSelect) contractTypeSelect.value = category;
          updateTextStats();
          return;
        }
      } catch (err) {
        console.error("Lỗi tải mẫu từ API:", err);
      }

      // Nếu lỗi, tra fallback
      const fallbackItem = FALLBACK_SAMPLES[filename];
      if (fallbackItem && textarea) {
        textarea.value = fallbackItem.text;
        if (contractTypeSelect) contractTypeSelect.value = fallbackItem.category;
        updateTextStats();
      }
    });
  }

  // =========================================================================
  // 6. XỬ LÝ KÉO THẢ TỆP & OCR
  // =========================================================================
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const fileInfo = document.getElementById("file-info");

  if (dropZone && fileInput) {
    dropZone.addEventListener("click", () => fileInput.click());

    ["dragenter", "dragover"].forEach(evtName => {
      dropZone.addEventListener(evtName, (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach(evtName => {
      dropZone.addEventListener(evtName, (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
      });
    });

    dropZone.addEventListener("drop", (e) => {
      const files = e.dataTransfer.files;
      if (files.length) handleFileUpload(files[0]);
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length) handleFileUpload(e.target.files[0]);
    });
  }

  async function handleFileUpload(file) {
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isBinary = lowerName.endsWith(".docx") || lowerName.endsWith(".doc") ||
                     lowerName.endsWith(".pdf") || lowerName.endsWith(".png") ||
                     lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") ||
                     lowerName.endsWith(".webp") || (file.type && file.type.startsWith("image/"));

    if (fileInfo) {
      fileInfo.textContent = `Đang bóc tách tệp: ${file.name} (${(file.size / 1024).toFixed(1)} KB)...`;
      fileInfo.classList.remove("hidden");
      fileInfo.style.backgroundColor = "";
      fileInfo.style.borderColor = "";
      fileInfo.style.color = "";
    }

    const formData = new FormData();
    formData.append("file", file);

    const endpoints = [`${API_BASE}/ocr`, "/ocr"];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: formData
        });

        if (res.ok) {
          const data = await res.json();
          const textarea = document.getElementById("contract-text");
          if (textarea) {
            textarea.value = data.text;
            updateTextStats();
          }
          if (fileInfo) {
            fileInfo.textContent = `✓ Đã trích xuất thành công: ${file.name} (${data.stats?.word_count || 0} từ)`;
          }
          return;
        }
      } catch (err) {
        console.warn(`Lỗi gọi OCR tại ${url}:`, err);
      }
    }

    // Nếu Backend API chưa xử lý được tệp nhị phân
    if (isBinary) {
      if (fileInfo) {
        fileInfo.textContent = `⚠️ Backend API đang Offline hoặc đang khởi động: Không thể giải mã tệp nhị phân (.docx / .pdf / ảnh) bằng trình duyệt. Vui lòng thử lại sau giây lát hoặc dán văn bản trực tiếp.`;
        fileInfo.style.backgroundColor = "var(--yellow-bg)";
        fileInfo.style.borderColor = "var(--yellow-border)";
        fileInfo.style.color = "var(--yellow-text)";
      }
      alert(`⚠️ Không thể bóc tách nội dung tệp nhị phân "${file.name}" khi Backend API chưa sẵn sàng.\n\nNguyên nhân: Tệp Word (.docx), PDF và Ảnh cần thư viện Python ở Backend để giải mã cấu trúc nén ZIP.\n\nGiải pháp: Vui lòng đợi Backend online hoặc dán trực tiếp nội dung văn bản vào ô soạn thảo.`);
      return;
    }

    // Chỉ đọc văn bản thuần bằng FileReader nếu là file .txt hoặc .md
    const reader = new FileReader();
    reader.onload = (evt) => {
      const textarea = document.getElementById("contract-text");
      if (textarea) {
        textarea.value = evt.target.result;
        updateTextStats();
      }
      if (fileInfo) fileInfo.textContent = `✓ Đã nạp văn bản: ${file.name}`;
    };
    reader.readAsText(file, "UTF-8");
  }

  // Cập nhật thống kê từ & ký tự
  function updateTextStats() {
    const textarea = document.getElementById("contract-text");
    const charEl = document.getElementById("char-count");
    const wordEl = document.getElementById("word-count");
    if (!textarea) return;

    const text = textarea.value || "";
    if (charEl) charEl.textContent = text.length;
    if (wordEl) wordEl.textContent = text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  const contractTextarea = document.getElementById("contract-text");
  if (contractTextarea) {
    contractTextarea.addEventListener("input", updateTextStats);
  }

  const btnClear = document.getElementById("btn-clear");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (contractTextarea) contractTextarea.value = "";
      if (fileInfo) fileInfo.classList.add("hidden");
      updateTextStats();
    });
  }

  // =========================================================================
  // 7. RÀ SOÁT HỢP ĐỒNG (PIPELINE 5 TẦNG & HITL REDLINING)
  // =========================================================================
  const btnAnalyze = document.getElementById("btn-analyze");
  const loadingCard = document.getElementById("review-loading");
  const resultsSection = document.getElementById("review-results");

  if (btnAnalyze) {
    btnAnalyze.addEventListener("click", async () => {
      const text = (contractTextarea ? contractTextarea.value : "").trim();
      if (!text) {
        alert("Vui lòng dán văn bản hợp đồng hoặc tải tệp lên trước khi bắt đầu rà soát.");
        return;
      }

      const domain = document.getElementById("contract-type-select")?.value || "rental";
      const perspective = document.getElementById("perspective-select")?.value || "party_b";

      state.contractText = text;
      state.contractType = domain;
      state.perspective = perspective;

      // Hiển thị trạng thái loading
      if (loadingCard) loadingCard.classList.remove("hidden");
      if (resultsSection) resultsSection.classList.add("hidden");

      // Mô phỏng tiến trình 5 tầng sinh động
      animateLoadingSteps();

      try {
        const payload = {
          contract_text: text,
          contract_type: domain,
          perspective: perspective
        };

        const res = await fetch(`${API_BASE}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          renderReviewResults(data);
          return;
        } else {
          console.warn("API trả về lỗi, kích hoạt client fallback.");
        }
      } catch (err) {
        console.warn("Lỗi kết nối /api/analyze, chuyển sang chạy mô hình kiểm thử phía client:", err);
      }

      // Fallback cục bộ khi chưa có API
      setTimeout(() => {
        const fallbackResult = runClientSideAnalysis(text, domain, perspective);
        renderReviewResults(fallbackResult);
      }, 1000);
    });
  }

  function animateLoadingSteps() {
    const title = document.getElementById("loading-step-title");
    const desc = document.getElementById("loading-step-desc");

    const steps = [
      { t: "Tầng 1 & 2: Ingestion & Segmentation", d: "Đang chuẩn hóa văn bản và bóc tách cấu trúc từng điều khoản..." },
      { t: "Tầng 3: Hybrid Legal RAG & NLI", d: "Đang truy xuất 42+ quy tắc luật định & kiểm tra quan hệ mâu thuẫn..." },
      { t: "Tầng 4: Reflection Critic & Proposal", d: "Đang triệt tiêu báo động giả và soạn thảo câu sửa đổi Redline..." },
      { t: "Tầng 5: Chuẩn bị giao diện Human-In-The-Loop", d: "Đang tổng hợp điểm số an toàn và kịch bản đàm phán 3 bước..." }
    ];

    let idx = 0;
    const interval = setInterval(() => {
      idx++;
      if (idx < steps.length && title && desc) {
        title.textContent = steps[idx].t;
        desc.textContent = steps[idx].d;
      } else {
        clearInterval(interval);
      }
    }, 600);
  }

  // Fallback phân tích phía client dựa trên từ khóa
  function runClientSideAnalysis(text, domain, perspective) {
    const textLower = text.toLowerCase();
    const detectedRisks = [];
    let redCount = 0;
    let yellowCount = 0;

    FALLBACK_RULES.forEach(r => {
      let matched = false;
      let snippet = "";

      for (const kw of r.keywords) {
        if (textLower.includes(kw.toLowerCase())) {
          matched = true;
          const idx = textLower.indexOf(kw.toLowerCase());
          const start = Math.max(0, text.lastIndexOf("\n", idx));
          const end = text.indexOf("\n", idx + kw.length);
          snippet = text.substring(start, end !== -1 ? end : text.length).trim();
          break;
        }
      }

      if (matched) {
        if (r.risk_level === "RED") redCount++;
        else yellowCount++;

        const propId = `PROP_${String(detectedRisks.length + 1).padStart(3, "0")}`;
        const script = perspective === "party_b"
          ? `Dạ em chào anh/chị, theo em được biết và tham khảo các quy định hiện hành tại ${r.legal_basis}, điều khoản này có thể phát sinh băn khoăn cho cả hai bên khi thực hiện. Em xin phép đề xuất mình điều chỉnh lại một chút thành: "${r.suggested_clause}" để hợp đồng rõ ràng, đúng luật và an tâm cho đôi bên ạ.`
          : `Kính gửi đối tác, trên tinh thần thiện chí và các chuẩn mực pháp lý tại ${r.legal_basis}, chúng tôi khuyến nghị điều chỉnh câu chữ thành: "${r.suggested_clause}" nhằm phòng ngừa rủi ro tranh chấp.`;

        detectedRisks.push({
          proposal_id: propId,
          rule_id: r.rule_id,
          rule_name: r.rule_name,
          risk_level: r.risk_level,
          related_article: "Điều khoản phát hiện",
          original_clause: snippet || `Điều khoản liên quan đến quy tắc ${r.rule_name}`,
          proposed_clause: r.suggested_clause,
          statutory_citation: r.legal_basis,
          reference_url: "https://vbpl.vn",
          negotiation_script: script,
          compromise_option: "Lập phụ lục làm rõ điều kiện hài hòa lợi ích song phương.",
          hitl_status: "PENDING"
        });
      }
    });

    const score = Math.max(1.0, Math.min(10.0, +(10.0 - redCount * 2.5 - yellowCount * 1.0).toFixed(1)));
    const verdict = (redCount === 0 && yellowCount === 0)
      ? "AN TOÀN - ĐỦ ĐIỀU KIỆN KÝ KẾT"
      : (redCount > 0 || score < 5.0)
      ? "RỦI RO CAO - CẦN ĐÀM PHÁN SỬA ĐỔI TRƯỚC KHI KÝ"
      : "CẦN THỎA THUẬN ĐIỀU CHỈNH MỘT SỐ ĐIỀU KHOẢN";

    return {
      status: "success",
      contract_type: domain,
      perspective: perspective,
      safety_score: score,
      verdict: verdict,
      executive_summary: `Phát hiện ${detectedRisks.length} điều khoản rủi ro (${redCount} vi phạm điều cấm, ${yellowCount} điều khoản bất lợi). Thang điểm an toàn: ${score}/10.`,
      total_risks_found: detectedRisks.length,
      red_risks_count: redCount,
      yellow_risks_count: yellowCount,
      is_fallback: true,
      warning_note: "Chạy chế độ Fallback Rule-based (Client Simulation)",
      proposals: detectedRisks
    };
  }

  // Hiển thị kết quả rà soát lên giao diện
  function renderReviewResults(data) {
    if (loadingCard) loadingCard.classList.add("hidden");
    if (resultsSection) resultsSection.classList.remove("hidden");

    state.proposals = data.proposals || [];

    // KPI Metrics
    const kpiScore = document.getElementById("kpi-score");
    const kpiVerdict = document.getElementById("kpi-verdict");
    const kpiTotal = document.getElementById("kpi-total-risks");
    const kpiRed = document.getElementById("kpi-red-risks");
    const kpiYellow = document.getElementById("kpi-yellow-risks");

    if (kpiScore) kpiScore.textContent = `${data.safety_score} / 10`;
    if (kpiVerdict) kpiVerdict.textContent = data.verdict;
    if (kpiTotal) kpiTotal.textContent = data.total_risks_found || 0;
    if (kpiRed) kpiRed.textContent = data.red_risks_count || 0;
    if (kpiYellow) kpiYellow.textContent = data.yellow_risks_count || 0;

    // Executive Summary
    const summaryTitle = document.getElementById("summary-verdict-title");
    const summaryText = document.getElementById("summary-text");
    const fallbackBadge = document.getElementById("fallback-warning-badge");

    if (summaryTitle) summaryTitle.textContent = `Phán quyết: ${data.verdict}`;
    if (summaryText) summaryText.textContent = data.executive_summary;

    if (fallbackBadge) {
      if (data.is_fallback) fallbackBadge.classList.remove("hidden");
      else fallbackBadge.classList.add("hidden");
    }

    // Render Proposal Cards
    renderProposalCards();

    // Scroll nhẹ xuống kết quả
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Render danh sách các thẻ Redline Proposal
  function renderProposalCards() {
    const container = document.getElementById("proposals-list");
    if (!container) return;

    if (!state.proposals || state.proposals.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 32px; background: #F0FDF4; border-color: #86EFAC;">
          <h3 style="color: #166534; font-size: 1.15rem;">✓ Không phát hiện điều khoản rủi ro!</h3>
          <p style="color: #15803D; font-size: 0.9rem; margin-top: 6px;">Văn bản hợp đồng tuân thủ tốt các quy định của pháp luật hiện hành.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";

    state.proposals.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "proposal-card";
      card.id = `card-${p.proposal_id}`;

      const riskBadgeClass = p.risk_level === "RED" ? "risk-badge red" : "risk-badge yellow";
      const riskText = p.risk_level === "RED" ? "RỦI RO ĐỎ: TRÁI LUẬT" : "RỦI RO VÀNG: BẤT LỢI";

      let statusBadgeHtml = '<span class="status-badge pending">⏳ Chờ duyệt</span>';
      if (p.hitl_status === "APPROVED") {
        statusBadgeHtml = '<span class="status-badge approved">✓ Đã chấp thuận</span>';
      } else if (p.hitl_status === "MODIFIED") {
        statusBadgeHtml = '<span class="status-badge modified">✎ Đã tùy chỉnh</span>';
      } else if (p.hitl_status === "REJECTED") {
        statusBadgeHtml = '<span class="status-badge rejected">✕ Đã từ chối (Giữ gốc)</span>';
      }

      card.innerHTML = `
        <div class="proposal-header">
          <div class="proposal-title-box">
            <span class="${riskBadgeClass}">${riskText}</span>
            <strong style="color: var(--brand-primary); font-size: 0.95rem;">#${idx + 1}. ${escapeHtml(p.rule_name)}</strong>
          </div>
          <div>${statusBadgeHtml}</div>
        </div>

        <div class="proposal-body">
          <div class="citation-meta">
            <b>Căn cứ pháp lý:</b> <i>${escapeHtml(p.statutory_citation || "Quy định pháp luật hiện hành")}</i>
            ${p.reference_url ? ` | <a href="${p.reference_url}" target="_blank" rel="noopener">Tra cứu CSDL vbpl.vn ↗</a>` : ""}
          </div>

          <div class="diff-container">
            <div class="diff-box original">
              <div class="diff-label">– CÂU VĂN GỐC TRONG HỢP ĐỒNG:</div>
              <div>${escapeHtml(p.original_clause)}</div>
            </div>
            <div class="diff-box proposed">
              <div class="diff-label">+ ĐỀ XUẤT SỬA ĐỔI CHUẨN MỰC (REDLINE AMENDMENT):</div>
              <div id="text-proposed-${p.proposal_id}">${escapeHtml(p.proposed_clause)}</div>
            </div>
          </div>

          <div class="script-bubble">
            <div class="script-label">💬 Kịch bản đàm phán hòa nhã gợi ý:</div>
            <div>"${escapeHtml(p.negotiation_script)}"</div>
          </div>

          <!-- Khu vực tùy chỉnh khi chọn Modify -->
          <div id="modify-box-${p.proposal_id}" class="custom-edit-box ${p.hitl_status === "MODIFIED" ? "" : "hidden"}">
            <label>Nội dung điều khoản do bạn tự nhập:</label>
            <textarea id="custom-text-${p.proposal_id}" class="custom-textarea">${escapeHtml(p.user_custom_clause || p.proposed_clause)}</textarea>
            <button class="btn btn-primary btn-sm btn-save-custom" data-id="${p.proposal_id}" style="margin-top: 6px;">
              Lưu nội dung tự sửa
            </button>
          </div>

          <!-- Thanh hành động HITL (Accept / Modify / Reject / Undo) -->
          <div class="proposal-actions">
            ${p.hitl_status === "PENDING" ? `
              <button class="btn btn-success btn-sm btn-accept" data-id="${p.proposal_id}">
                ✓ Chấp thuận (Accept)
              </button>
              <button class="btn btn-secondary btn-sm btn-modify-toggle" data-id="${p.proposal_id}">
                ✎ Tự sửa (Modify)
              </button>
              <button class="btn btn-secondary btn-sm btn-reject" data-id="${p.proposal_id}">
                ✕ Từ chối (Reject)
              </button>
            ` : `
              <button class="btn btn-secondary btn-sm btn-undo" data-id="${p.proposal_id}">
                ↺ Hoàn tác thẩm định
              </button>
            `}
          </div>
        </div>
      `;

      container.appendChild(card);
    });

    attachHITLEvents();
  }

  // Gắn sự kiện cho các nút Accept / Modify / Reject / Undo
  function attachHITLEvents() {
    // Chấp thuận (Accept)
    document.querySelectorAll(".btn-accept").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        updateProposalStatus(id, "APPROVED");
      });
    });

    // Bật khung tự sửa (Modify)
    document.querySelectorAll(".btn-modify-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const box = document.getElementById(`modify-box-${id}`);
        if (box) box.classList.toggle("hidden");
      });
    });

    // Lưu nội dung tự sửa
    document.querySelectorAll(".btn-save-custom").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const customText = document.getElementById(`custom-text-${id}`)?.value || "";
        updateProposalStatus(id, "MODIFIED", customText);
      });
    });

    // Từ chối (Reject)
    document.querySelectorAll(".btn-reject").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        updateProposalStatus(id, "REJECTED");
      });
    });

    // Hoàn tác (Undo)
    document.querySelectorAll(".btn-undo").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        updateProposalStatus(id, "PENDING");
      });
    });
  }

  function updateProposalStatus(id, status, customClause = null) {
    const prop = state.proposals.find(p => p.proposal_id === id);
    if (!prop) return;

    prop.hitl_status = status;
    if (status === "MODIFIED" && customClause) {
      prop.user_custom_clause = customClause;
    }
    renderProposalCards();
  }

  // Bulk Approve
  const btnBulkApprove = document.getElementById("btn-bulk-approve");
  if (btnBulkApprove) {
    btnBulkApprove.addEventListener("click", () => {
      state.proposals.forEach(p => {
        if (p.hitl_status === "PENDING") {
          p.hitl_status = "APPROVED";
        }
      });
      renderProposalCards();
    });
  }

  // =========================================================================
  // 8. TÁI CẤU TRÚC & LẮP RÁP HỢP ĐỒNG HOÀN THIỆN (/api/assemble)
  // =========================================================================
  const btnAssemble = document.getElementById("btn-assemble");
  const finalTextarea = document.getElementById("final-contract-text");
  const btnDownload = document.getElementById("btn-download-contract");
  const btnCopy = document.getElementById("btn-copy-contract");

  if (btnAssemble) {
    btnAssemble.addEventListener("click", async () => {
      const origText = state.contractText || document.getElementById("contract-text")?.value || "";
      if (!origText.trim()) {
        alert("Vui lòng tải hoặc dán hợp đồng gốc trước khi lắp ráp.");
        return;
      }

      btnAssemble.disabled = true;
      btnAssemble.textContent = "Đang lắp ráp...";

      try {
        const payload = {
          original_contract_text: origText,
          proposals: state.proposals.map(p => ({
            proposal_id: p.proposal_id,
            hitl_status: p.hitl_status,
            custom_clause: p.user_custom_clause || null,
            original_clause: p.original_clause,
            proposed_clause: p.proposed_clause
          }))
        };

        const res = await fetch(`${API_BASE}/assemble`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          state.finalAssembledText = data.final_contract_text;
          if (finalTextarea) finalTextarea.value = state.finalAssembledText;
          if (btnDownload) btnDownload.disabled = false;
          alert(`✓ Đã lắp ráp hợp đồng hoàn thiện! Đã áp dụng ${data.applied_changes_count || 0} điều khoản được duyệt.`);
          return;
        }
      } catch (err) {
        console.warn("Không thể gọi /api/assemble, kích hoạt lắp ráp chuỗi cục bộ:", err);
      } finally {
        btnAssemble.disabled = false;
        btnAssemble.textContent = "🔄 Tạo hợp đồng hoàn thiện";
      }

      // Fallback: Lắp ráp trực tiếp phía Client
      let assembled = origText;
      let appliedCount = 0;

      state.proposals.forEach(p => {
        if (p.hitl_status === "APPROVED" || p.hitl_status === "MODIFIED") {
          const replacement = (p.hitl_status === "MODIFIED" && p.user_custom_clause)
            ? p.user_custom_clause
            : p.proposed_clause;

          const orig = (p.original_clause || "").trim();
          if (orig && assembled.includes(orig)) {
            assembled = assembled.replace(orig, replacement);
            appliedCount++;
          }
        }
      });

      state.finalAssembledText = assembled;
      if (finalTextarea) finalTextarea.value = assembled;
      if (btnDownload) btnDownload.disabled = false;
      alert(`✓ Đã lắp ráp hợp đồng hoàn thiện (Client)! Đã cập nhật ${appliedCount} điều khoản.`);
    });
  }

  // Tải xuống file .txt
  if (btnDownload) {
    btnDownload.addEventListener("click", () => {
      const text = state.finalAssembledText || finalTextarea?.value || "";
      if (!text) return;

      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hop_dong_hoan_thien_redline_${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Sao chép nội dung
  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      const text = finalTextarea?.value || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        btnCopy.textContent = "✓ Đã sao chép!";
        setTimeout(() => { btnCopy.textContent = "📋 Sao chép nội dung"; }, 2000);
      } catch (e) {
        alert("Không thể tự động sao chép, vui lòng bôi đen và nhấn Ctrl+C.");
      }
    });
  }

  // =========================================================================
  // 9. THƯ VIỆN PHÁP LUẬT (TAB 2: LEGAL RULES EXPLORER)
  // =========================================================================
  async function loadLegalRules() {
    let rulesList = [];

    try {
      const res = await fetch(`${API_BASE}/rules`);
      if (res.ok) {
        const data = await res.json();
        const rental = data.rental?.rules || [];
        const employment = data.employment?.rules || [];
        rulesList = [
          ...rental.map(r => ({ ...r, domain: "rental" })),
          ...employment.map(r => ({ ...r, domain: "employment" }))
        ];
      }
    } catch (err) {
      console.log("Dùng danh mục luật fallback.");
    }

    if (!rulesList.length) {
      rulesList = FALLBACK_RULES.map(r => ({
        ...r,
        domain: r.rule_id.includes("LABOR") ? "employment" : "rental"
      }));
    }

    state.rules = rulesList;
    const totalEl = document.getElementById("total-rules-count");
    if (totalEl) totalEl.textContent = `${rulesList.length} Quy tắc`;

    renderRulesGrid(rulesList);
  }

  function renderRulesGrid(rules) {
    const grid = document.getElementById("rules-grid");
    if (!grid) return;

    if (!rules || !rules.length) {
      grid.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">Không tìm thấy quy tắc pháp lý nào khớp với tìm kiếm.</p>';
      return;
    }

    grid.innerHTML = "";
    rules.forEach(r => {
      const card = document.createElement("div");
      card.className = "rule-card";

      const riskBadgeClass = r.risk_level === "RED" ? "risk-badge red" : "risk-badge yellow";
      const domainText = r.domain === "employment" ? "💼 Lao động" : "🏠 Thuê nhà";

      card.innerHTML = `
        <div class="rule-card-header">
          <div>
            <span class="rule-category">${domainText} • ${escapeHtml(r.category || "Quy định")}</span>
            <h4 class="rule-title">${escapeHtml(r.rule_name)}</h4>
          </div>
          <span class="${riskBadgeClass}">${r.risk_level}</span>
        </div>
        <div class="rule-basis">⚖️ ${escapeHtml(r.legal_basis || r.statutory_citation || "")}</div>
        <p class="rule-desc"><b>Dấu hiệu vi phạm:</b> ${escapeHtml(r.trigger_condition || r.explanation || "")}</p>
        <div class="rule-suggested">
          <b>Đề xuất chuẩn:</b> "${escapeHtml(r.suggested_clause || "")}"
        </div>
      `;
      grid.appendChild(card);
    });
  }

  // Bộ lọc và tìm kiếm cho Tab 2
  const ruleSearchInput = document.getElementById("rule-search-input");
  const ruleCatFilter = document.getElementById("rule-category-filter");
  const ruleLevelFilter = document.getElementById("rule-level-filter");

  function filterRules() {
    const q = (ruleSearchInput?.value || "").toLowerCase().trim();
    const cat = ruleCatFilter?.value || "all";
    const lvl = ruleLevelFilter?.value || "all";

    const filtered = (state.rules || []).filter(r => {
      const matchCat = (cat === "all") || (r.domain === cat);
      const matchLvl = (lvl === "all") || (r.risk_level === lvl);
      const matchQ = !q || (
        (r.rule_name && r.rule_name.toLowerCase().includes(q)) ||
        (r.legal_basis && r.legal_basis.toLowerCase().includes(q)) ||
        (r.trigger_condition && r.trigger_condition.toLowerCase().includes(q)) ||
        (r.keywords && r.keywords.some(k => k.toLowerCase().includes(q)))
      );
      return matchCat && matchLvl && matchQ;
    });

    renderRulesGrid(filtered);
  }

  if (ruleSearchInput) ruleSearchInput.addEventListener("input", filterRules);
  if (ruleCatFilter) ruleCatFilter.addEventListener("change", filterRules);
  if (ruleLevelFilter) ruleLevelFilter.addEventListener("change", filterRules);

  // Helper escape HTML để tránh XSS
  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // =========================================================================
  // 10. TỰ ĐỘNG CHẠY KHI TẢI TRANG
  // =========================================================================
  async function init() {
    await checkApiHealth();
    await loadSamples();
    await loadLegalRules();
    updateTextStats();
  }

  init();
});
