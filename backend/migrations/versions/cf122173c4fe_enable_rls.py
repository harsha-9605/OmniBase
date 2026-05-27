"""enable_rls

Revision ID: cf122173c4fe
Revises: cbbb1c8ed205
Create Date: 2026-05-27 16:53:27.488023

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = 'cf122173c4fe'
down_revision: Union[str, Sequence[str], None] = 'cbbb1c8ed205'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Direct tables (with tenant_id)
    op.execute('ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE "user" FORCE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE project ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE project FORCE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE invitation FORCE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE scheduledmessage ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE scheduledmessage FORCE ROW LEVEL SECURITY;')

    # Indirect tables (linked via project_id/message_id)
    op.execute('ALTER TABLE projectmember ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE projectmember FORCE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE message ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE message FORCE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE reaction ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE reaction FORCE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE userprojectstate ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE userprojectstate FORCE ROW LEVEL SECURITY;')

    # Create policies
    op.execute("""
    CREATE POLICY user_isolation ON "user" FOR ALL USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
        OR account_id = NULLIF(current_setting('app.current_account_id', true), '')::integer
    );
    """)

    op.execute("""
    CREATE POLICY project_isolation ON project FOR ALL USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
    );
    """)

    op.execute("""
    CREATE POLICY invitation_isolation ON invitation FOR ALL USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
    );
    """)

    op.execute("""
    CREATE POLICY scheduledmessage_isolation ON scheduledmessage FOR ALL USING (
        project_id IN (
            SELECT id FROM project 
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
        )
    );
    """)

    op.execute("""
    CREATE POLICY projectmember_isolation ON projectmember FOR ALL USING (
        project_id IN (
            SELECT id FROM project 
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
        )
    );
    """)

    op.execute("""
    CREATE POLICY message_isolation ON message FOR ALL USING (
        project_id IN (
            SELECT id FROM project 
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
        )
    );
    """)

    op.execute("""
    CREATE POLICY reaction_isolation ON reaction FOR ALL USING (
        message_id IN (
            SELECT id FROM message
            WHERE project_id IN (
                SELECT id FROM project
                WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
            )
        )
    );
    """)

    op.execute("""
    CREATE POLICY userprojectstate_isolation ON userprojectstate FOR ALL USING (
        project_id IN (
            SELECT id FROM project 
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
        )
    );
    """)


def downgrade() -> None:
    # Drop policies
    op.execute('DROP POLICY IF EXISTS user_isolation ON "user";')
    op.execute('DROP POLICY IF EXISTS project_isolation ON project;')
    op.execute('DROP POLICY IF EXISTS invitation_isolation ON invitation;')
    op.execute('DROP POLICY IF EXISTS scheduledmessage_isolation ON scheduledmessage;')
    op.execute('DROP POLICY IF EXISTS projectmember_isolation ON projectmember;')
    op.execute('DROP POLICY IF EXISTS message_isolation ON message;')
    op.execute('DROP POLICY IF EXISTS reaction_isolation ON reaction;')
    op.execute('DROP POLICY IF EXISTS userprojectstate_isolation ON userprojectstate;')

    # Disable RLS
    op.execute('ALTER TABLE "user" DISABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE project DISABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE invitation DISABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE scheduledmessage DISABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE projectmember DISABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE message DISABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE reaction DISABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE userprojectstate DISABLE ROW LEVEL SECURITY;')

