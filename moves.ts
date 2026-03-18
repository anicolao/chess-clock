import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileSync } from "fs";

// Initialize the API with the key from the environment
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error(JSON.stringify({ error: "GEMINI_API_KEY environment variable is required" }));
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash-lite",
  generationConfig: { responseMimeType: "application/json" }
});

// Helper to read image into the format Gemini expects
function fileToGenerativePart(path: string) {
  return {
    inlineData: {
      data: Buffer.from(readFileSync(path)).toString("base64"),
      mimeType: "image/jpeg",
    },
  };
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(JSON.stringify({ error: "Usage: bun moves.ts IMG1.jpg [IMG2.jpg]" }));
    process.exit(1);
  }

  const prompt = args.length === 1 
    ? "Analyze the chess board image. Return JSON: { \"fen\": \"current_fen\", \"position\": string[][] }."
    : `I am providing two images of a chess board.
Image 1: Board state BEFORE a move.
Image 2: Board state AFTER a move.
Identify which piece moved from its original square in Image 1 to its new square in Image 2.
Pay very close attention to Black's moves (top of board) vs White's moves (bottom of board).
Only report the move that occurred between these two exact images.
Return JSON: { "move": "e7e6", "san": "e6" }.`;

  try {
    const imageParts = args.map(fileToGenerativePart);
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    console.log(response.text().trim());
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(1);
  }
}

run();
