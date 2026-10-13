#!/usr/bin/env python3
"""Upload the static Check App bundle to a dedicated, chrooted REG.RU FTPS account."""
import ftplib
import os
import pathlib
import ssl

host = os.environ["REG_FTP_HOST"]
user = os.environ["REG_FTP_USER"]
password = os.environ["REG_FTP_PASSWORD"]
root = pathlib.Path("dist-mobile")
if not (root / "index.html").is_file():
    raise SystemExit("Missing dist-mobile/index.html; run npm run build:mobile first")

# Verify the server certificate and encrypt both FTP control and data channels.
ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=30)
try:
    ftp.connect(host, 21)
    ftp.login(user, password)
    ftp.prot_p()
    print("FTPS connected; account root:", ftp.pwd())
    # This login is confined to /www/app-check.ru by ISPmanager.
    ftp.cwd("/")
    count = 0
    for file in sorted(root.rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(root)
        directory = relative.parent.parts
        ftp.cwd("/")
        for part in directory:
            try:
                ftp.cwd(part)
            except ftplib.error_perm as error:
                if not str(error).startswith("550"):
                    raise
                ftp.mkd(part)
                ftp.cwd(part)
        with file.open("rb") as stream:
            ftp.storbinary("STOR " + relative.name, stream)
        count += 1
        print("Uploaded:", relative.as_posix())
    print(f"Uploaded {count} files. Existing unrelated files were not deleted.")
finally:
    try:
        ftp.quit()
    except (OSError, EOFError, ftplib.all_errors):
        ftp.close()
