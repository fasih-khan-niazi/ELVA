from dotenv import load_dotenv
import os
from supabase import create_client
from langchain_ollama import OllamaEmbeddings

load_dotenv()

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

EMBEDDING_MODEL = "nomic-embed-text"
embeddings = OllamaEmbeddings(model=EMBEDDING_MODEL)

def test_query(query_text, threshold=0.1):
    print(f"\nTesting query: '{query_text}' with threshold {threshold}")
    query_embedding = embeddings.embed_query(query_text)
    
    response = supabase.rpc(
        'match_documents',
        {
            'query_embedding': query_embedding,
            'match_threshold': threshold,
            'match_count': 10
        }
    ).execute()
    
    if not response.data:
        print("No matches found.")
    else:
        for doc in response.data:
            print(f"Score: {doc['similarity']:.4f} | Content: {doc['content'][:50]}... | Metadata: {doc['metadata']}")

if __name__ == "__main__":
    test_query("Hunzala")
    test_query("Hunzala Amajd")
