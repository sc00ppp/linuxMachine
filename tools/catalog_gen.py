#!/usr/bin/env python3
"""Regenerate Custom TV's catalog.json on the machine that holds the videos.

The Node importer (tools/import-customtv.mjs) is the source of truth when run
from a dev machine, but the bot and its downloads now live on the media PC and
that box has no Node. Without something here, a freshly downloaded video sits
on disk invisible until someone rebuilds the whole shell — which defeats the
point of the runtime catalog.

This is deliberately stdlib-only (sqlite3, os, json, struct) so it runs next to
the bot with no install step. It emits the same schema the shell expects.

Durations are carried over from the previous catalog where the file is
unchanged, and parsed from the MP4 container otherwise — the shell's live TV
scheduler needs them, and a video with no duration cannot be scheduled.
"""
import json
import hashlib
import os
import re
import sqlite3
import struct
import sys
import unicodedata
from urllib.parse import quote

VIDEO_EXTS = {'.3gp', '.avi', '.flv', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4',
              '.mpeg', '.mpg', '.ogv', '.ts', '.webm', '.wmv'}
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}

# encodeURIComponent's unreserved set: A-Z a-z 0-9 - _ . ! ~ * ' ( )
JS_SAFE = "-_.!~*'()"


def mp4_duration(path):
    """Seconds from the mvhd box, or None. Mirrors the Node importer's reader."""
    try:
        size = os.path.getsize(path)
        with open(path, 'rb') as handle:
            def boxes(start, end):
                offset = start
                while offset + 8 <= end:
                    handle.seek(offset)
                    header = handle.read(16)
                    if len(header) < 8:
                        return
                    box_size = struct.unpack('>I', header[0:4])[0]
                    kind = header[4:8].decode('latin1')
                    head = 8
                    if box_size == 1:
                        if len(header) < 16:
                            return
                        box_size = struct.unpack('>Q', header[8:16])[0]
                        head = 16
                    elif box_size == 0:
                        box_size = end - offset
                    if box_size < head or offset + box_size > end:
                        return
                    yield offset, box_size, kind, head
                    offset += box_size

            for off, sz, kind, head in boxes(0, size):
                if kind != 'moov':
                    continue
                for coff, csz, ckind, chead in boxes(off + head, off + sz):
                    if ckind != 'mvhd':
                        continue
                    handle.seek(coff + chead)
                    payload = handle.read(40)
                    if len(payload) < 20:
                        return None
                    version = payload[0]
                    if version == 1:
                        if len(payload) < 32:
                            return None
                        timescale = struct.unpack('>I', payload[20:24])[0]
                        duration = struct.unpack('>Q', payload[24:32])[0]
                    else:
                        timescale = struct.unpack('>I', payload[12:16])[0]
                        duration = struct.unpack('>I', payload[16:20])[0]
                    if not timescale or duration <= 0:
                        return None
                    return duration / timescale
    except Exception:
        return None
    return None


def display_name(value):
    cleaned = re.sub(r'[-_]+', ' ', str(value)).strip()
    return re.sub(r'(^|\s)(\w)', lambda m: m.group(1) + m.group(2).upper(), cleaned)


def title_from_filename(filename):
    stem = os.path.splitext(filename)[0]
    return re.sub(r'\s+', ' ', re.sub(r'[._]+', ' ', stem)).strip() or 'Untitled video'


def match_key(value):
    normalized = unicodedata.normalize('NFKD', str(value)).lower()
    return re.sub(r'[^0-9a-z]+', '', normalized)


def main():
    bot_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(bot_dir, 'config.json')
    with open(config_path, encoding='utf-8-sig') as handle:
        config = json.load(handle)

    root = config.get('download_base_path') or r'S:\customTV'
    db_path = config.get('database_path') or os.path.join(bot_dir, 'video_tracker.db')
    out_path = os.path.join(root, 'catalog.json')
    thumbnail_base_url = str(config.get('thumbnail_base_url') or
                             'http://192.168.1.158:8099/customTV').rstrip('/')

    # Reuse what the last catalog already worked out; parsing every container
    # on every run would make this far too slow to attach to the bot.
    previous = {}
    try:
        with open(out_path, encoding='utf-8') as handle:
            for video in json.load(handle).get('videos', []):
                previous[video.get('media_url')] = video
    except Exception:
        pass

    # Titles and source URLs come from the bot's own database when it knows the
    # file; anything dropped in by hand still gets an entry from its filename.
    by_title = {}
    try:
        conn = sqlite3.connect(db_path)
        for url, title, filename in conn.execute(
                "select url, title, filename from downloads where status='completed'"):
            if filename:
                by_title[match_key(os.path.basename(filename))] = (url, title)
            if title:
                by_title.setdefault(match_key(title), (url, title))
        conn.close()
    except Exception as error:
        print(f'[catalog] database unreadable: {error}', file=sys.stderr)

    categories, videos = [], []
    for entry in sorted(os.listdir(root)):
        folder = os.path.join(root, entry)
        if not os.path.isdir(folder):
            continue
        sidecars = {}
        for candidate in os.listdir(folder):
            stem, candidate_ext = os.path.splitext(candidate)
            candidate_path = os.path.join(folder, candidate)
            if os.path.isfile(candidate_path) and candidate_ext.lower() in IMAGE_EXTS:
                sidecars.setdefault(stem.casefold(), candidate)
        count = 0
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            ext = os.path.splitext(name)[1].lower()
            if not os.path.isfile(path) or ext not in VIDEO_EXTS:
                continue

            # Must byte-for-byte match the Node importer's encodeURIComponent,
            # or carried-over thumbnails and ids silently fail to line up.
            # Python's default quote() escapes ! ' ( ) * where JS does not, and
            # these filenames are full of apostrophes.
            media_url = '/' + quote(entry, safe=JS_SAFE) + '/' + quote(name, safe=JS_SAFE)
            carried = previous.get(media_url)
            carried_id = carried.get('id') if carried else None
            if carried_id and not str(carried_id).startswith('fs-'):
                video_id = carried_id
            else:
                digest = hashlib.sha256(media_url.encode('utf-8')).hexdigest()[:14]
                video_id = 'fs-' + digest
            stat = os.stat(path)
            duration = carried.get('duration_seconds') if carried else None
            if duration is None or (carried and carried.get('size_bytes') != stat.st_size):
                duration = mp4_duration(path) if ext in ('.mp4', '.m4v', '.mov') else None

            source_url, title = by_title.get(match_key(name), (None, None))
            sidecar = sidecars.get(os.path.splitext(name)[0].casefold())
            if sidecar:
                thumbnail_path = ('/' + quote(entry, safe=JS_SAFE) + '/' +
                                  quote(sidecar, safe=JS_SAFE))
                thumbnail = thumbnail_base_url + thumbnail_path
                thumbnail_source = 'source'
            else:
                thumbnail = carried.get('thumbnail') if carried else None
                thumbnail_source = carried.get('thumbnail_source') if carried else None
            videos.append({
                'id': video_id,
                'category': entry,
                'title': title or title_from_filename(name),
                'filename': name,
                'url': source_url,
                'media_url': media_url,
                'thumbnail': thumbnail,
                'thumbnail_source': thumbnail_source,
                'size_bytes': stat.st_size,
                'extension': ext.lstrip('.'),
                'duration_seconds': duration,
                'downloaded_at': carried.get('downloaded_at') if carried else None,
            })
            count += 1
        if count:
            categories.append({'id': entry, 'display_name': display_name(entry),
                               'video_count': count})

    catalog = {
        'generated_at': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
        'categories': categories,
        'videos': videos,
        'mismatches': {'completed_rows_missing_files': 0,
                       'disk_videos_without_completed_row': 0},
    }

    partial = out_path + '.tmp'
    with open(partial, 'w', encoding='utf-8') as handle:
        json.dump(catalog, handle, indent=2, ensure_ascii=False)
    os.replace(partial, out_path)
    print(f'catalog: {len(categories)} categories, {len(videos)} videos -> {out_path}')


if __name__ == '__main__':
    main()
