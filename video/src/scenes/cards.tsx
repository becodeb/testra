import { EASE, progress, spring, SPRINGS } from "../motion";
import { useScene } from "../scene-context";
import { CARDS, type Card } from "../timeline";

const RISE = 30;
const STAGGER = 0.055;
/** Seconds after a card starts lifting before the next UI starts to emerge. */
export const EMERGE_DELAY = 0.2;

interface Word {
  text: string;
  key: boolean;
}

function words(card: Card): Word[] {
  const out: Word[] = [];
  let key = false;
  for (const raw of card.text.split(" ")) {
    const opens = raw.startsWith("*");
    const closes = raw.endsWith("*");
    if (opens) key = true;
    out.push({ text: raw.replace(/\*/g, ""), key });
    if (closes) key = false;
  }
  return out;
}

/** Screen-space text card: words rise in with a short blur and lift out. */
export function CardText() {
  const { t } = useScene();
  const card = CARDS.find((c) => t >= c.in - 0.01 && t < c.out + 0.6);
  if (!card) return null;
  const list = words(card);
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center px-40">
      <p className="text-center text-[70px] leading-[1.12] font-semibold tracking-[-.025em] text-ink">
        {list.map((w, i) => {
          const tin = card.in + i * STAGGER;
          const tout = card.out + i * 0.03;
          const pin = spring(t - tin, SPRINGS.soft);
          const oin = EASE.app(progress(t, tin, tin + 0.28));
          const pout = EASE.out(progress(t, tout, tout + 0.22));
          const opacity = oin * (1 - pout);
          const blur = (1 - oin) * 8 + pout * 6;
          const y = (1 - pin) * RISE - pout * 22;
          return (
            <span key={i} className={w.key ? "text-brand" : undefined} style={{ display: "inline-block", whiteSpace: "pre", opacity, filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined, transform: `translateY(${y.toFixed(2)}px)` }}>
              {w.text}
              {i < list.length - 1 ? " " : ""}
            </span>
          );
        })}
      </p>
    </div>
  );
}

/**
 * How present the UI is at t (1 = fully on stage). Around each card the UI
 * recedes (scales down a touch while fading) and later emerges (settles from
 * slightly large). Before the first card lifts it is not there at all.
 */
export function uiPresence(t: number): { opacity: number; scale: number } {
  let opacity = 1;
  let scale = 1;
  for (const [i, c] of CARDS.entries()) {
    const recede = i === 0 ? 1 : EASE.inOut(progress(t, c.in - 0.35, c.in + 0.02));
    // The UI comes back once the words are mostly gone, so text never stacks on text.
    const e0 = c.out + EMERGE_DELAY;
    const emerge = EASE.out(progress(t, e0, e0 + 0.45));
    if (t >= c.in - 0.35 && t < e0) {
      opacity = 1 - recede;
      scale = 1 - 0.06 * recede;
    } else if (t >= e0 && t < e0 + 0.45) {
      opacity = emerge;
      scale = 1.035 - 0.035 * spring(t - e0, SPRINGS.soft);
    }
    if (i === 0 && t < c.in - 0.35) opacity = 0;
  }
  return { opacity, scale };
}
