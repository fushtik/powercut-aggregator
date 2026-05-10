#!/usr/bin/env python3
"""
Execute database schema SQL against Supabase or PostgreSQL
Usage: python3 execute-schema.py <supabase_url> <service_role_key>
"""

import sys
import os
import json
from pathlib import Path

def execute_schema():
    """Execute the schema SQL file"""

    # Get Supabase credentials from arguments or environment
    supabase_url = os.getenv('SUPABASE_URL') or (sys.argv[1] if len(sys.argv) > 1 else None)
    service_role_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or (sys.argv[2] if len(sys.argv) > 2 else None)

    if not supabase_url or not service_role_key:
        print("❌ Error: Missing Supabase credentials")
        print("\nUsage:")
        print("  python3 execute-schema.py <SUPABASE_URL> <SERVICE_ROLE_KEY>")
        print("\nOr set environment variables:")
        print("  export SUPABASE_URL=https://your-project.supabase.co")
        print("  export SUPABASE_SERVICE_ROLE_KEY=your-key")
        sys.exit(1)

    # Read schema file
    schema_path = Path(__file__).parent.parent / 'src' / 'db' / 'schema.sql'

    if not schema_path.exists():
        print(f"❌ Schema file not found: {schema_path}")
        sys.exit(1)

    with open(schema_path, 'r') as f:
        schema_sql = f.read()

    print("🔄 Initializing database schema...")
    print(f"📍 Connecting to: {supabase_url}")
    print(f"\n📋 Schema file size: {len(schema_sql)} bytes")

    # Try using psycopg2 (direct PostgreSQL)
    try:
        import psycopg2
        from urllib.parse import urlparse

        # Parse Supabase connection string
        # Supabase format: https://project-id.supabase.co
        # We need to construct PostgreSQL connection URL

        print("\n✅ Using psycopg2 for direct PostgreSQL connection")

        # For Supabase, we need the direct PostgreSQL connection
        # URL format: postgresql://user:password@host/database
        # You can get this from Supabase: Project Settings → Database → Connection string

        db_url = os.getenv('DATABASE_URL')
        if not db_url:
            print("\n⚠️  DATABASE_URL not set. Cannot use direct PostgreSQL connection.")
            print("   Please use the Supabase web UI to execute the schema:")
            print("   1. Open: https://app.supabase.com/project/[project-id]/sql/new")
            print("   2. Paste the contents of src/db/schema.sql")
            print("   3. Click 'Run' → 'Run without RLS'")
            sys.exit(1)

        conn = psycopg2.connect(db_url, sslmode='require')
        cursor = conn.cursor()

        print("\n📝 Executing schema SQL...\n")

        # Execute the entire schema
        cursor.execute(schema_sql)
        conn.commit()

        print("✅ Schema executed successfully!")

        # Verify tables
        cursor.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)

        tables = cursor.fetchall()
        print("\n📋 Created tables:")
        for (table_name,) in tables:
            print(f"   ✅ {table_name}")

        cursor.close()
        conn.close()

        print("\n✨ Database initialization complete!")
        return 0

    except ImportError:
        print("\n⚠️  psycopg2 not available. Trying alternative methods...\n")
    except Exception as e:
        print(f"\n❌ Error: {e}\n")

    # Fallback: Instructions for using Supabase web UI
    print("📝 To execute the schema, use the Supabase web interface:\n")
    print("1. Open your Supabase project:")
    print(f"   https://app.supabase.com/project/[project-id]/sql/new\n")
    print("2. Copy the schema SQL from: src/db/schema.sql\n")
    print("3. Paste it into the SQL Editor query box\n")
    print("4. Click 'Run' button (or Cmd+Enter)\n")
    print("5. When prompted about RLS, select 'Run without RLS'\n")
    print("6. Verify the 4 tables were created in Table Editor\n")

    return 1

if __name__ == '__main__':
    sys.exit(execute_schema())
