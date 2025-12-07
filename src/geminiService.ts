import { GoogleGenAI, Type } from "@google/genai";
import { Dancer, Position, STAGE_WIDTH, STAGE_HEIGHT } from "../types";

// Initialize Gemini Client
// Note: API Key must be set in process.env.API_KEY
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateFormation = async (
  prompt: string,
  dancers: Dancer[]
): Promise<Record<string, Position> | null> => {
  try {
    const ai = getAiClient();
    const modelId = "gemini-2.5-flash"; // Fast model for interactive tools

    const systemInstruction = `
      You are a professional choreographer assistant. 
      Your task is to arrange dancers on a stage based on a description.
      The stage is ${STAGE_WIDTH} units wide and ${STAGE_HEIGHT} units tall.
      (0,0) is top-left. Center is (${STAGE_WIDTH / 2}, ${STAGE_HEIGHT / 2}).
      Keep dancers within bounds with a 20 unit padding.
      Return a JSON object where keys are dancer IDs and values are objects with x and y coordinates.
      Only return the JSON.
    `;

    const dancerIds = dancers.map(d => d.id).join(", ");
    
    const userPrompt = `
      Create a formation for these dancer IDs: [${dancerIds}].
      Description of formation: "${prompt}".
    `;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                positions: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            dancerId: { type: Type.STRING },
                            x: { type: Type.NUMBER },
                            y: { type: Type.NUMBER }
                        },
                        required: ["dancerId", "x", "y"]
                    }
                }
            }
        }
      },
    });

    const text = response.text;
    if (!text) return null;

    const data = JSON.parse(text);
    const result: Record<string, Position> = {};
    
    if (data.positions && Array.isArray(data.positions)) {
        data.positions.forEach((item: any) => {
            if (dancers.find(d => d.id === item.dancerId)) {
                result[item.dancerId] = { x: item.x, y: item.y };
            }
        });
    }

    return result;

  } catch (error) {
    console.error("Error generating formation:", error);
    return null;
  }
};