#!/usr/bin/env python3
"""Back up precisely the static files a deployment will replace over verified FTPS."""
import argparse
import datetime
import ftplib
import hashlib
import json
import os
from pathlib import Path
import ssl


def backup_files(ftp, bundle, output):
    output.mkdir(parents=True, exist_ok=False)
    records = []
    listings = {}

    def listing(parts):
        if parts in listings:
            return listings[parts]
        if parts:
            parent = listing(parts[:-1])
            entry = parent.get(parts[-1]) if parent is not None else None
            if entry is None:
                listings[parts] = None
                return None
            if entry.get('type') != 'dir':
                raise RuntimeError('Remote directory is not a regular directory: ' + '/'.join(parts))
        ftp.cwd('/')
        for part in parts:
            ftp.cwd(part)
        listings[parts] = {name: facts for name, facts in ftp.mlsd(facts=['type']) if name not in {'.', '..'}}
        return listings[parts]

    for source in sorted(bundle.rglob('*')):
        if not source.is_file():
            continue
        relative = source.relative_to(bundle)
        contents = listing(relative.parent.parts)
        entry = contents.get(relative.name) if contents is not None else None
        record = {'path': relative.as_posix(), 'existed': entry is not None}
        if entry is not None:
            if entry.get('type') != 'file':
                raise RuntimeError('Refusing to replace non-file: ' + relative.as_posix())
            destination = output / 'files' / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            ftp.cwd('/')
            with destination.open('wb') as stream:
                ftp.retrbinary('RETR ' + relative.as_posix(), stream.write)
            record['sha256'] = hashlib.sha256(destination.read_bytes()).hexdigest()
            record['size'] = destination.stat().st_size
        records.append(record)
    manifest = {'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'source_commit': os.environ.get('GITHUB_SHA', ''), 'files': records}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=Path('dist-mobile'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not (args.bundle / 'index.html').is_file():
        raise SystemExit('Build the website before backing up its replacement files')
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=60)
    try:
        ftp.connect(os.environ['REG_FTP_HOST'], 21)
        ftp.login(os.environ['REG_FTP_USER'], os.environ['REG_FTP_PASSWORD'])
        ftp.prot_p()
        manifest = backup_files(ftp, args.bundle, args.output)
        print('Backup complete:', sum(row['existed'] for row in manifest['files']), 'existing files;',
              sum(not row['existed'] for row in manifest['files']), 'new paths recorded')
    finally:
        try:
            ftp.quit()
        except (OSError, EOFError, ftplib.Error):
            ftp.close()


if __name__ == '__main__':
    main()
