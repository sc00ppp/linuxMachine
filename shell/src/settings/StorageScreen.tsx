import { useCallback, useEffect, useRef } from 'react';
import { useFocusable } from '../focus';
import { BoltIcon, DrivesIcon } from '../icons';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import { STORAGE_DRIVES, STORAGE_SCAN_NOTE, formatGb, type StorageDrive } from './storageData';
import { cssVars, prefersReducedMotion } from './util';
import './StorageScreen.css';
import { glideIntoView } from '../motion/glide';

/**
 * The Storage screen (CONTRACTS.md Round 3.5) — the room's marquee screen.
 * Two big drive cards, each a horizontal segment bar with channel-accented
 * categories and a "x of y free" headline big enough to read from the
 * couch. Data comes from storageData.ts, shaped so the daemon can feed real
 * numbers later without this component changing.
 */
export function StorageScreen() {
  return (
    <div className="storage-screen">
      <div className="storage-drives">
        {STORAGE_DRIVES.map((drive, i) => (
          <DriveCard key={drive.id} drive={drive} autoFocus={i === 0} />
        ))}
      </div>
      <p className="storage-scannote">{STORAGE_SCAN_NOTE}</p>
    </div>
  );
}

interface DriveCardProps {
  drive: StorageDrive;
  autoFocus?: boolean;
}

function DriveCard({ drive, autoFocus }: DriveCardProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const usedGb = drive.totalGb - drive.freeGb;
  const ringAccent = drive.categories[0]?.color ?? '#6f93a8';

  // The card is informational, not actionable yet — accept gets a gentle
  // "acknowledged" pulse rather than a hard refusal, same placeholder
  // language as the Controllers overlay's inert chips (ControllersOverlay.tsx).
  const pulse = useCallback(() => {
    const el = elRef.current;
    if (!el || prefersReducedMotion()) return;
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.012)' }, { transform: 'scale(1)' }],
      { duration: tuning.drillInMs, easing: tuning.popEase },
    );
  }, []);

  const accept = useCallback(() => {
    sound.play('edge');
    pulse();
  }, [pulse]);

  const { ref: focusRef, focused } = useFocusable({
    id: `storage-drive-${drive.id}`,
    scope: 'settings',
    onAccept: accept,
    autoFocus,
  });

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      focusRef(el);
    },
    [focusRef],
  );

  // Cards can outnumber the visible screen (a future third drive, a smaller
  // TV), so follow focus the same way every other room's scroller does.
  useEffect(() => {
    if (!focused) return;
    glideIntoView(elRef.current, { block: 'nearest' });
  }, [focused]);

  return (
    <div
      ref={setRef}
      className="drive-card glass"
      data-focused={focused ? 'true' : undefined}
      role="button"
      aria-label={`${drive.label}, ${formatGb(drive.freeGb)} free of ${formatGb(drive.totalGb)}`}
      style={cssVars({ '--accent': ringAccent })}
    >
      <div className="drive-card__top">
        <div className="drive-card__identity">
          <span className="drive-card__glyph" aria-hidden="true">
            {drive.kind === 'SSD' ? <BoltIcon /> : <DrivesIcon />}
          </span>
          <div>
            <h3>{drive.label}</h3>
            <p className="drive-card__kind">
              {formatGb(drive.totalGb)} · {drive.kind}
            </p>
          </div>
        </div>

        <div className="drive-card__free">
          <strong>{formatGb(drive.freeGb)}</strong>
          <span>
            free of {formatGb(drive.totalGb)} · {formatGb(usedGb)} used
          </span>
        </div>
      </div>

      <div className="drive-bar" aria-hidden="true">
        {drive.categories.map((category) => (
          <div
            key={category.id}
            className="drive-bar__seg"
            style={cssVars({
              '--seg-color': category.color,
              '--seg-share': category.gb / drive.totalGb,
            })}
          />
        ))}
        <div
          className="drive-bar__free"
          style={cssVars({ '--seg-share': drive.freeGb / drive.totalGb })}
        />
      </div>

      <div className="drive-card__legend">
        {drive.categories.map((category) => (
          <span className="drive-legend__item" key={category.id}>
            <span
              className="drive-legend__dot"
              style={cssVars({ '--seg-color': category.color })}
              aria-hidden="true"
            />
            {category.label}
            <b>{formatGb(category.gb)}</b>
          </span>
        ))}
        <span className="drive-legend__item drive-legend__item--free">
          <span className="drive-legend__dot drive-legend__dot--free" aria-hidden="true" />
          Free
          <b>{formatGb(drive.freeGb)}</b>
        </span>
      </div>
    </div>
  );
}
