#!/usr/bin/env python3
"""Publish what the Discord downloader is doing, for the console to display.

The bot runs headless on the media PC, so the only sign it is working is files
quietly appearing. This writes a small status.json beside the media, which
mediaserve already serves, so the shell can show a download indicator without
needing any new API or a connection to the bot itself.

Deliberately stdlib-only and cheap: it reads the bot's SQLite for counts and
tails its log for the in-flight title and percentage, so it can run every
minute without noticeable cost.
"""
import json
import os
import re
import sqlite3
import sys

# yt-dlp's progress lines, e.g. "[download]  42.3% of  86.01MiB at 1.2MiB/s"
PROGRESS = re.compile(r'\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(\w+)')
DESTINATION = re.compile(r'\[download\] Destination:\s*(.+)')
# How far back to read the log. Progress lines are frequent, so this is plenty.
TAIL_BYTES = 64 * 1024


def tail(path, size=TAIL_BYTES):
    try:
        with open(path, 'rb') as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - size))
            return handle.read().decode('utf-8', 'replace')
    except Exception:
        return ''


def active_download(log_text):
    """Title and percent of whatever is downloading, from the log's tail."""
    title, percent = None, None
    for line in log_text.splitlines():
        found = DESTINATION.search(line)
        if found:
            title = os.path.splitext(os.path.basename(found.group(1).strip()))[0]
            percent = 0.0
            continue
        progress = PROGRESS.search(line)
        if progress:
            try:
                percent = float(progress.group(1))
            except ValueError:
                pass
    return title, percent


def write_status():
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        with open(os.path.join(here, 'config.json'), encoding='utf-8-sig') as handle:
            config = json.load(handle)
    except Exception:
        config = {}

    root = config.get('download_base_path') or r'S:\customTV'
    db_path = config.get('database_path') or os.path.join(here, 'video_tracker.db')

    counts = {}
    try:
        conn = sqlite3.connect(db_path)
        counts = {status: n for status, n in
                  conn.execute('select status, count(*) from downloads group by status')}
        conn.close()
    except Exception as error:
        print(f'[status] database unreadable: {error}', file=sys.stderr)

    log_text = tail(os.path.join(here, 'bot.log'))
    title, percent = active_download(log_text)

    # A stale log means the bot is idle or gone; do not claim a live download.
    log_path = os.path.join(here, 'bot.log')
    fresh = False
    try:
        import time
        fresh = (time.time() - os.path.getmtime(log_path)) < 120
    except Exception:
        pass

    status = {
        'pending': counts.get('pending', 0),
        'completed': counts.get('completed', 0),
        'failed': counts.get('failed', 0),
        'active': ({'title': title, 'percent': percent}
                   if (fresh and title is not None and (percent or 0) < 100) else None),
    }

    out = os.path.join(root, 'status.json')
    partial = out + '.tmp'
    with open(partial, 'w', encoding='utf-8') as handle:
        json.dump(status, handle, ensure_ascii=False)
    os.replace(partial, out)
    return status


def main():
    write_status()


if __name__ == '__main__':
    main()
