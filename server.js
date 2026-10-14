require("dotenv").config();
const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

app.post("/api/simulate", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "伺服器尚未設定 GEMINI_API_KEY。請在 Render 的 Environment 設定 Gemini API 金鑰。"
      });
    }

    const { action, scenario, tone, level, history = [] } = req.body || {};
    if (!["start", "reply", "analyze"].includes(action)) {
      return res.status(400).json({ error: "不支援的操作。" });
    }

    const system = `你是一位協助國小教師練習親師溝通的情境模擬教練。全程使用繁體中文（台灣用語）。
目標情境：${scenario}
教師練習目標：${tone}
家長情緒程度：${level}
安全與專業原則：
- 模擬家長時要自然、貼近學校常見情況，不要突然跳出角色。
- 情緒激動的家長可以表達不滿，但不要使用威脅、歧視或過度辱罵語句。
- 不要編造真實學生資料，也不要要求輸入可識別學生的個資。
- 不要假裝知道未提供的事實；遇到爭議鼓勵查證、釐清雙方觀點並依學校流程處理。
- 教師回覆應兼顧同理、清楚說明、合作解決問題與專業界線，不應承諾無法確定的結果。
操作規則：
- action=start：只輸出家長第一句話，約 1–3 句，帶出情境即可。
- action=reply：根據對話歷程，繼續以家長角色回覆，約 1–3 句，提出合理追問或回應，不要替教師作答。
- action=analyze：不要再扮演家長。根據整段對話給教師回饋，使用以下結構：
一、整體回饋（簡短）
二、做得好的地方（列點）
三、可以調整的地方（列點）
四、溝通技巧評估（同理心、清楚表達、專業界線、合作解決問題，各以 1–5 分並說明）
五、建議回覆示範（提供一段可實際參考的回覆）
六、下一次練習重點（1–2 點）
回饋具體、友善、不羞辱使用者；若對話資訊不足，明確說明無法判定的部分。`;

    let task;
    if (action === "start") {
      task = "請開始這個情境，只回覆家長的第一句話。";
    } else if (action === "reply") {
      const transcript = history.slice(-16).filter(item => item && ["parent", "teacher"].includes(item.role) && typeof item.content === "string")
        .map(item => `${item.role === "parent" ? "家長" : "老師"}：${item.content.slice(0, 3000)}`).join("\n");
      task = `以下是目前對話，請以家長角色自然接續，只回覆家長的下一句話：\n${transcript}`;
    } else {
      const transcript = history.slice(-24).map(item =>
        `${item && item.role === "parent" ? "家長" : "老師"}：${String(item?.content || "").slice(0, 2500)}`
      ).join("\n");
      task = "請分析以下練習對話：\n" + transcript;
    }

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
      contents: task,
      config: {
        systemInstruction: system,
        temperature: action === "analyze" ? 0.4 : 0.8,
        maxOutputTokens: action === "analyze" ? 1300 : 350
      }
    });
    const output = response.text?.trim();
    if (!output) return res.status(502).json({ error: "AI 沒有產生文字，請再試一次。" });
    res.json(action === "analyze" ? { analysis: output } : { message: output });
  } catch (error) {
    console.error("Gemini Simulation API error:", error.status || "", error.message || error);
    res.status(500).json({ error: "Gemini AI 目前無法使用，請確認 Gemini API 金鑰、免費額度或稍後再試。" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`親師溝通情境模擬練習器已啟動，Port: ${PORT}`);
});
