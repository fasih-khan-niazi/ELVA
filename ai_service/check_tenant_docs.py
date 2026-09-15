from dotenv import load_dotenv
import os
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

TENANT_ID = "69247f4e886ceb2a84ae8b47"

print(f"\nChecking documents for tenant: {TENANT_ID}")
print("=" * 60)

response = supabase.table('documents').select('id, metadata, content').execute()

tenant_docs = []
for doc in response.data:
    metadata = doc.get('metadata', {})
    if metadata.get('tenant_id') == TENANT_ID:
        tenant_docs.append(doc)

print(f"\nFound {len(tenant_docs)} documents for your tenant:")

for i, doc in enumerate(tenant_docs, 1):
    print(f"\n{'='*60}")
    print(f"Document {i}:")
    print(f"ID: {doc['id']}")
    print(f"Agent ID: {doc.get('metadata', {}).get('agent_id', 'NOT SET')}")
    print(f"\nFull Content:")
    print("-" * 40)
    print(doc['content'])
    print("-" * 40)
