require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Note: To list models, use the base request structure or check the AI Studio console.
    console.log("Checking available models...");
    // If you are in AI Studio, you can view the 'Model' dropdown to see supported names.
}
listModels();