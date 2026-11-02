import styles from './study.module.css';

/**
 * The study's two charts, as plain server-rendered HTML (no client JS). Each repeats a table on the page, which
 * holds the exact numbers; a mark's title gives its value on hover.
 */

type Scored = { id: string; name: string; total: number | null; categories: Record<string, number | null> };
type Timed = { id: string; name: string; details: { speedSeconds: Record<string, number | string | null> } };

/** Total score as a stacked bar per tool: how much each category contributed. */
export function ScoreBars({ tools, categories }: { tools: Scored[]; categories: readonly (readonly [string, string, number])[] }) {
  return (
    <figure className={styles.viz}>
      <figcaption>
        Where each tool’s points come from <span>· out of 100</span>
      </figcaption>
      <ul className={styles.legend} aria-hidden="true">
        {categories.map(([k, label], i) => (
          <li key={k}>
            <span className={styles.swatch} style={{ background: `var(--series-${i + 1})` }} />
            {label}
          </li>
        ))}
      </ul>
      <div className={styles.rows}>
        {tools.map((t) => (
          <div className={styles.row} key={t.id}>
            <span className={styles.name}>{t.name}</span>
            <span className={styles.track} aria-hidden="true">
              {categories.map(([k, label, max], i) => {
                const v = t.categories[k] ?? 0;
                return (
                  <span
                    key={k}
                    className={styles.seg}
                    title={`${label}: ${v.toFixed(1)} of ${max}`}
                    style={{ width: `${v}%`, background: `var(--series-${i + 1})` }}
                  />
                );
              })}
            </span>
            <span className={styles.value}>{t.total?.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Median time to format 1 MB and 10 MB in Chromium, fastest first; a failed size has no bar. */
export function SpeedChart({ tools }: { tools: Timed[] }) {
  const panel = (size: '1mb' | '10mb', title: string) => {
    const rows = tools
      .map((t) => ({ t, v: t.details.speedSeconds[size] }))
      .sort((a, b) => (typeof a.v === 'number' ? a.v : Infinity) - (typeof b.v === 'number' ? b.v : Infinity));
    const max = Math.max(...rows.map((r) => (typeof r.v === 'number' ? r.v : 0)), 0.001);
    return (
      <div>
        <p className={styles.name}>
          <strong>{title}</strong>
        </p>
        <div className={styles.rows}>
          {rows.map(({ t, v }) => (
            <div className={styles.row} key={t.id}>
              <span className={styles.name}>{t.name}</span>
              <span className={styles.track} aria-hidden="true">
                {typeof v === 'number' && (
                  <span className={styles.seg} title={`${t.name}: ${v.toFixed(2)} s`} style={{ width: `${(v / max) * 100}%`, background: 'var(--series-1)' }} />
                )}
              </span>
              <span className={typeof v === 'number' ? styles.value : `${styles.value} ${styles.failed}`}>
                {typeof v === 'number' ? `${v < 10 ? v.toFixed(2) : v.toFixed(1)} s` : 'failed'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <figure className={styles.viz}>
      <figcaption>
        Median time to format, Chromium <span>· shorter is better · each panel has its own scale</span>
      </figcaption>
      <div className={styles.panels}>
        {panel('1mb', '1 MB file')}
        {panel('10mb', '10 MB file')}
      </div>
    </figure>
  );
}
