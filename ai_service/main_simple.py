from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
import os
import shutil
from dotenv import load_dotenv

# IMPORTANT: Load environment variables BEFORE importing rag_utils
load_dotenv()

app = FastAPI()

class QueryRequest(BaseModel):
    query: str
    tenant_id: str

@app.get("/")
def read_root():
    return {"status": "AI Service is running"}

@app.post("/ingest")
async def ingest_document(file: UploadFile = File(...), tenant_id: str = Form(...)):
    """
    PDF ingestion endpoint - currently disabled until Supabase pgvector is set up
    """
    print(f"Ingestion request received for: {file.filename}, tenant: {tenant_id}")
    print("Note: PDF ingestion requires Supabase pgvector to be configured")
    
    # Return success without actually ingesting for now
    return {
        "message": "File received (ingestion pending pgvector setup)", 
        "chunks": 0,
        "note": "Please set up Supabase pgvector extension to enable full RAG functionality"
    }

@app.post("/chat")
async def chat(request: QueryRequest):
    try:
        print(f"Chat request - Query: {request.query}, Tenant: {request.tenant_id}")
        
        # For now, respond without RAG context until pgvector is set up
        from langchain_ollama import OllamaLLM
        llm = OllamaLLM(model="llama3.2")
        
        # Simple prompt without context
        prompt = f"You are a helpful AI assistant. Answer this question: {request.query}"
        print("Generating response with Ollama (without RAG context)...")
        response = llm.invoke(prompt)
        print(f"Response generated: {len(response)} characters")
        
        return {
            "response": response, 
            "context": "No document context available yet - pgvector setup pending",
            "note": "Install pgvector extension in Supabase to enable knowledge base queries"
        }
    except Exception as e:
        print(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
