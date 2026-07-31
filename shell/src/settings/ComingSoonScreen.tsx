import './ComingSoonScreen.css';

interface ComingSoonScreenProps {
  glyph: string;
  title: string;
  note: string;
}

/** The friendly placeholder for Network and System (CONTRACTS.md Round 3.5). */
export function ComingSoonScreen({ glyph, title, note }: ComingSoonScreenProps) {
  return (
    <div className="coming-soon">
      <span className="coming-soon__glyph" aria-hidden="true">
        {glyph}
      </span>
      <h2>{title} is coming soon</h2>
      <p>{note}</p>
    </div>
  );
}
