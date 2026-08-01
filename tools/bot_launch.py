"""Launch the Discord downloader with a log and a readable death.

The bot kept dying on the media PC after a minute or two with nothing in the
log to say why — it just stopped mid-line. Three things conspired:

* It ran windowless, so anything printed to a stream this shim did not replace
  went nowhere.
* Those original streams are cp1252, and the bot and yt-dlp both print video
  titles, so a single curly quote or emoji raises UnicodeEncodeError.
* Nothing caught a top-level exception, so the process exited silently.

So: force UTF-8 everywhere including the original handles, tee everything to a
log, install faulthandler for the crashes Python cannot catch, and wrap the
whole run so the reason is always written down before exiting.
"""
import faulthandler
import io
import os
import runpy
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(HERE, 'bot.log')

log = open(LOG_PATH, 'a', encoding='utf-8', buffering=1)


class Tee(io.TextIOBase):
    """Write to the log and, when it exists and is usable, the real stream."""

    def __init__(self, *streams):
        self.streams = streams

    def write(self, text):
        for stream in self.streams:
            if stream is None:
                continue
            try:
                stream.write(text)
                stream.flush()
            except Exception:
                # A dead or non-UTF-8 console must never take the bot down.
                pass
        return len(text)

    def flush(self):
        for stream in self.streams:
            try:
                if stream is not None:
                    stream.flush()
            except Exception:
                pass

    def isatty(self):
        return False


def _utf8(stream):
    """Re-encode a real stream as UTF-8 so titles cannot kill it."""
    if stream is None:
        return None
    try:
        return io.TextIOWrapper(stream.buffer, encoding='utf-8', errors='replace',
                                line_buffering=True)
    except Exception:
        return None


# Replace BOTH the current and the original handles: libraries that captured
# sys.__stdout__ at import time were writing to a cp1252 console.
sys.__stdout__ = _utf8(sys.__stdout__)
sys.__stderr__ = _utf8(sys.__stderr__)
sys.stdout = Tee(log, sys.__stdout__)
sys.stderr = Tee(log, sys.__stderr__)

# Segfaults and hard aborts never raise, so catch them at the OS level too.
faulthandler.enable(file=log)

log.write('\n=== bot_launch starting ===\n')
log.write(f'python {sys.version}\n')
log.write(f'executable {sys.executable}\n')


def _publish_status():
    """Keep status.json fresh enough to drive a real progress bar.

    A scheduled task cannot run more often than once a minute, which made the
    console's indicator show a percentage from a download that had already
    finished — it read as frozen. Writing from inside the process that is doing
    the downloading costs nothing and is always current.
    """
    import time
    try:
        from status_gen import write_status
    except Exception:
        log.write('=== status publisher unavailable ===\n')
        return

    while True:
        try:
            write_status()
        except Exception:
            # The indicator is decorative; never let it disturb downloading.
            pass
        time.sleep(2)


import threading  # noqa: E402  (deliberately after the streams are set up)

threading.Thread(target=_publish_status, daemon=True, name='status').start()

try:
    runpy.run_path(os.path.join(HERE, 'bot.py'), run_name='__main__')
    log.write('=== bot.py returned normally ===\n')
except SystemExit as exit_request:
    log.write(f'=== SystemExit({exit_request.code}) ===\n')
except BaseException:
    # BaseException, not Exception: KeyboardInterrupt and friends were exiting
    # without leaving any trace of what happened.
    log.write('=== bot died with an exception ===\n')
    traceback.print_exc(file=log)
    log.flush()
    raise
finally:
    log.write('=== bot_launch exiting ===\n')
    log.flush()
