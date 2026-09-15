from dotenv import load_dotenv
import os
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

# Check what documents exist in the database
print("\n" + "="*60)
print("CHECKING DOCUMENTS IN SUPABASE DATABASE")
print("="*60)

try:
    # Query documents table
    response = supabase.table('documents').select('id, metadata, content').execute()
    
    if response.data:
        print(f"\nFound {len(response.data)} documents in database:")
        for i, doc in enumerate(response.data[:15], 1):  # Show first 15
            metadata = doc.get('metadata', {})
            tenant_id = metadata.get('tenant_id', 'unknown')
            agent_id = metadata.get('agent_id', 'NOT SET')
            content_preview = doc.get('content', '')[:80]
            
            print(f"\n{i}. Document ID: {doc['id']}")
            print(f"   Tenant ID: {tenant_id}")
            print(f"   Agent ID: {agent_id}")
            print(f"   Content: {content_preview}...")
    else:
        print("\n❌ NO DOCUMENTS FOUND IN DATABASE!")
        print("This means no PDFs have been successfully uploaded yet.")
        
except Exception as e:
    print(f"\n❌ Error checking database: {e}")

print("\n" + "="*60)
