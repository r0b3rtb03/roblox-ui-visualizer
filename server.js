require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large JSON payloads

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/generate-preview', async (req, res) => {
    try {
        const uiData = req.body;
        
        // We use gemini-2.5-flash for fast, code-heavy generation
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
        You are an expert UX prototyping engineer. I am providing you with a JSON structural dump of a Roblox UI. 
        Analyze the class names, text labels, and layout to infer what this UI is meant to do.
        
        Write a single, self-contained HTML file with embedded CSS and JavaScript that faithfully renders this UI 
        and mocks its intended interactive behavior (e.g. typing, clicking, opening dropdowns). 
        
        Return ONLY the raw HTML code. Do not use markdown blocks.
        
        UI JSON Data:
        ${JSON.stringify(uiData, null, 2)}
        `;

        const result = await model.generateContent(prompt);
        let htmlCode = result.response.text();
        
        // Clean up markdown formatting if the model accidentally includes it
        htmlCode = htmlCode.replace(/^```html/i, '').replace(/```$/i, '').trim();

        res.json({ html: htmlCode });
    } catch (error) {
        console.error("Gemini API Error:", error);
        res.status(500).json({ error: "Failed to generate preview." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`AI Proxy Server running on http://localhost:${PORT}`);
});