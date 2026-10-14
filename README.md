# 親師溝通情境模擬練習器

## 功能
- 選擇常見親師溝通情境或輸入自訂情境
- 選擇溝通目標與家長情緒程度
- AI 扮演家長，讓教師進行多輪對話練習
- 結束後提供溝通技巧分析、分項評分與示範回覆

## 本機執行
1. 安裝 Node.js。
2. 在此資料夾開啟終端機，執行 `npm install`。
3. 將 `.env.example` 複製為 `.env`，並填入自己的 `OPENAI_API_KEY`。
4. 執行 `npm start`。
5. 開啟 `http://localhost:3000`。

## 部署到 Render
1. 將整個資料夾上傳到一個新的 GitHub repository。
2. 在 Render 建立新的 Web Service，連接該 repository。
3. Build Command：`npm install`
4. Start Command：`npm start`
5. 在 Render 的 Environment 加入：
   - `OPENAI_API_KEY` = 你的 API 金鑰
   - `OPENAI_MODEL` = `gpt-4o-mini`
6. 部署完成後，使用 Render 提供的網址。

## 重要提醒
- 不要把真正的 API 金鑰寫進前端 HTML、GitHub repository 或公開文件。
- 這個專案需要可用的 OpenAI API 金鑰；API 使用可能產生費用。
- 建議不要輸入學生或家長的真實姓名、聯絡方式、健康資訊等個資。
- AI 回饋是練習參考，正式事件應以查證後的事實及學校規範為準。
