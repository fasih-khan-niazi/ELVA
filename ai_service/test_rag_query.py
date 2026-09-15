from dotenv import load_dotenv
import os
from supabase import create_client
from langchain_ollama import OllamaEmbeddings

load_dotenv()

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

TENANT_ID = "69247f4e886ceb2a84ae8b47"
AGENT_ID = "692ada2896bb4224c21371e4"
QUERY = "whats your menu"

print(f"\n{'='*60}")
print(f"Testing RAG Query")
print(f"Query: {QUERY}")
print(f"Tenant: {TENANT_ID}")
print(f"Agent: {AGENT_ID}")
print(f"{'='*60}")

# Get embedding
embeddings = OllamaEmbeddings(model="nomic-embed-text")
query_embedding = embeddings.embed_query(QUERY)
print(f"\nEmbedding generated: {len(query_embedding)} dimensions")

# Query Supabase
response = supabase.rpc(
    'match_documents',
    {
        'query_embedding': query_embedding,
        'match_threshold': 0.25,
        'match_count': 100
    }
).execute()

docs = response.data or []
print(f"\nRaw results from DB: {len(docs)} documents")

# Show all results with their metadata
print(f"\n--- All Results ---")
for i, doc in enumerate(docs[:10], 1):
    metadata = doc.get('metadata', {})
    similarity = doc.get('similarity', 0)
    tenant = metadata.get('tenant_id', 'NONE')
    agent = metadata.get('agent_id', 'NONE')
    content = doc.get('content', '')[:80].replace('\n', ' ')
    
    match_status = ""
    if tenant == TENANT_ID:
        match_status += "✅TENANT "
    else:
        match_status += "❌TENANT "
    if agent == AGENT_ID or agent == 'NONE':
        match_status += "✅AGENT"
    else:
        match_status += "❌AGENT"
    
    print(f"\n{i}. Similarity: {similarity:.3f} | {match_status}")
    print(f"   Tenant: {tenant}")
    print(f"   Agent: {agent}")
    print(f"   Content: {content}...")

# Filter for our tenant/agent
filtered = []
for doc in docs:
    metadata = doc.get('metadata', {})
    if metadata.get('tenant_id') != TENANT_ID:
        continue
    doc_agent = metadata.get('agent_id')
    if doc_agent is None or doc_agent == AGENT_ID:
        filtered.append(doc)

print(f"\n{'='*60}")
print(f"After filtering for tenant {TENANT_ID}: {len(filtered)} documents")
if filtered:
    print("\n--- Filtered Results ---")
    for doc in filtered:
        print(f"\nSimilarity: {doc.get('similarity', 0):.3f}")
        print(doc.get('content', '')[:200])
else:
    print("❌ NO DOCUMENTS MATCHED YOUR TENANT/AGENT!")
