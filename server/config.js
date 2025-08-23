/**
 * Configuration for Gemini AI service
 * Contains API settings, model configuration, and safety settings
 */

import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load environment variables first
dotenv.config({ override: true });

// Environment validation
if (!process.env.GEMINI_API_KEY) {
  throw new Error('❌ GEMINI_API_KEY не встановлено в змінних середовища!');
}

// Initialize Gemini AI
export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Model configuration from environment
export const modelName = process.env.MODEL_NAME || 'gemini-2.5-flash';
export const FALLBACK_MODEL_NAME = process.env.FALLBACK_MODEL_NAME || null;

// Generation configuration from environment
export const GENERATION_CONFIG = {
  temperature: parseFloat(process.env.TEMPERATURE) || 0.3,
  topK: parseInt(process.env.TOP_K) || 40,
  topP: parseFloat(process.env.TOP_P) || 0.8,
  maxOutputTokens: parseInt(process.env.MAX_TOKENS) || 65536,
};

// Safety settings
export const SAFETY_SETTINGS = [
  {
    category: 'HARM_CATEGORY_HARASSMENT',
    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
  },
  {
    category: 'HARM_CATEGORY_HATE_SPEECH',
    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
  },
  {
    category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
  },
  {
    category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
  },
];

// Batching configuration from environment
export const OPTIMAL_BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 10;
export const DELAY_BETWEEN_BATCHES = parseInt(process.env.BATCH_DELAY) || 1500;
export const BATCH_THRESHOLD = parseInt(process.env.BATCH_THRESHOLD) || 15;
export const MAX_TOKENS_PER_BATCH = parseInt(process.env.MAX_TOKENS_PER_BATCH) || 60000;
