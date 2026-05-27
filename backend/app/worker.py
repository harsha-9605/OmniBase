import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import aiosmtplib
from arq.connections import RedisSettings
from urllib.parse import urlparse

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Parse Redis URL for RedisSettings
parsed_redis = urlparse(REDIS_URL)
redis_host = parsed_redis.hostname or "localhost"
redis_port = parsed_redis.port or 6379
redis_password = parsed_redis.password or None

async def send_invite_email(ctx, recipient: str, workspace_name: str, invite_url: str) -> bool:
    """Asynchronously dispatch workspace invite email using aiosmtplib."""
    gmail_user = os.getenv("GMAIL_ADDRESS")
    gmail_password = os.getenv("GMAIL_APP_PASSWORD")
    mail_server = os.getenv("MAIL_SERVER", "smtp.gmail.com")
    mail_port = int(os.getenv("MAIL_PORT", 587))

    if not gmail_user or not gmail_password:
        print("Worker Error: Email credentials are missing in environment.")
        return False

    msg = MIMEMultipart()
    msg['From'] = gmail_user
    msg['To'] = recipient
    msg['Subject'] = f"OmniBase: You've been invited to join the {workspace_name} workspace"

    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #2dd4bf;">Welcome to OmniBase</h2>
        <p>Hello,</p>
        <p>An engineer has invited you to collaborate on the <strong>{workspace_name}</strong> workspace inside OmniBase—a high-performance, real-time developer collaboration cluster.</p>
        <p>By joining this workspace, you will gain instant access to live team channels, automated project resource boards, and integrated AI assistant utilities built directly into your communication streams.</p>
        <div style="margin: 30px 0;">
          <a href="{invite_url}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Accept Invitation & Join Team</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999;">Security Note: This invitation token expires in 48 hours.</p>
      </body>
    </html>
    """
    msg.attach(MIMEText(html, 'html'))

    try:
        smtp_client = aiosmtplib.SMTP(
            hostname=mail_server,
            port=mail_port,
            use_tls=False,
        )
        await smtp_client.connect()
        if mail_port == 587:
            await smtp_client.starttls()
        await smtp_client.login(gmail_user, gmail_password)
        await smtp_client.send_message(msg)
        await smtp_client.quit()
        print(f"Worker Success: Email sent to {recipient}")
        return True
    except Exception as e:
        print(f"Worker Exception sending email to {recipient}: {str(e)}")
        raise e

class WorkerSettings:
    functions = [send_invite_email]
    redis_settings = RedisSettings(
        host=redis_host,
        port=redis_port,
        password=redis_password,
    )
