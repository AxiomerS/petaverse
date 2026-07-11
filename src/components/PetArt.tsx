import { type ReactNode } from "react";
import { petById } from "../game/pets";

// Кастомные SVG-иллюстрации питомцев (милый плоский стиль, общий для всех).
// Каждый рисунок — это содержимое внутри общего <svg viewBox="0 0 100 100">.
// Видов, которых ещё не нарисовали, тут нет → PetArt покажет для них эмодзи (фолбэк).
const PET_SVG: Record<string, ReactNode> = {
  // 🐶 Dog — рыжий пёс с висячими ушами
  dog: (
    <>
      <ellipse cx="23" cy="49" rx="13" ry="22" fill="#a96a33" transform="rotate(-14 23 49)" />
      <ellipse cx="77" cy="49" rx="13" ry="22" fill="#a96a33" transform="rotate(14 77 49)" />
      <circle cx="50" cy="50" r="32" fill="#e8b06a" />
      <ellipse cx="50" cy="63" rx="20" ry="16" fill="#f6dcb4" />
      <circle cx="40" cy="46" r="4.6" fill="#2b2118" />
      <circle cx="60" cy="46" r="4.6" fill="#2b2118" />
      <circle cx="41.6" cy="44.4" r="1.5" fill="#fff" />
      <circle cx="61.6" cy="44.4" r="1.5" fill="#fff" />
      <ellipse cx="50" cy="56" rx="5.2" ry="3.8" fill="#2b2118" />
      <path d="M50 60 q-6 8 -12 3" stroke="#9c6a3a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M50 60 q6 8 12 3" stroke="#9c6a3a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M46 62 q4 9 8 0 z" fill="#f3899a" />
    </>
  ),
  // 🐱 Cat — серый котик с зелёными глазами и усами
  cat: (
    <>
      <path d="M26 32 L30 8 L47 27 Z" fill="#8b94a0" />
      <path d="M74 32 L70 8 L53 27 Z" fill="#8b94a0" />
      <path d="M31 27 L33 15 L41 25 Z" fill="#f0a9b8" />
      <path d="M69 27 L67 15 L59 25 Z" fill="#f0a9b8" />
      <circle cx="50" cy="53" r="32" fill="#9aa3ad" />
      <ellipse cx="39" cy="51" rx="5.6" ry="7.8" fill="#aede7a" />
      <ellipse cx="61" cy="51" rx="5.6" ry="7.8" fill="#aede7a" />
      <ellipse cx="39" cy="51" rx="1.9" ry="7" fill="#26331c" />
      <ellipse cx="61" cy="51" rx="1.9" ry="7" fill="#26331c" />
      <path d="M46 60 L54 60 L50 64.5 Z" fill="#f0a9b8" />
      <path d="M50 64 q-5 5 -10 2.5" stroke="#5c636d" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M50 64 q5 5 10 2.5" stroke="#5c636d" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M30 55 H11" stroke="#d6dbe1" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M31 60 H13" stroke="#d6dbe1" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M70 55 H89" stroke="#d6dbe1" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M69 60 H87" stroke="#d6dbe1" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  // 🐰 Rabbit — белый кролик с длинными ушами и зубками
  rabbit: (
    <>
      <ellipse cx="39" cy="22" rx="7" ry="20" fill="#f7f3f4" transform="rotate(-8 39 22)" />
      <ellipse cx="61" cy="22" rx="7" ry="20" fill="#f7f3f4" transform="rotate(8 61 22)" />
      <ellipse cx="39" cy="23" rx="3.2" ry="13" fill="#f3a9bd" transform="rotate(-8 39 23)" />
      <ellipse cx="61" cy="23" rx="3.2" ry="13" fill="#f3a9bd" transform="rotate(8 61 23)" />
      <circle cx="50" cy="56" r="30" fill="#f7f3f4" />
      <circle cx="34" cy="60" r="4" fill="#fbd6e0" opacity="0.7" />
      <circle cx="66" cy="60" r="4" fill="#fbd6e0" opacity="0.7" />
      <circle cx="40" cy="53" r="4.2" fill="#3a2e33" />
      <circle cx="60" cy="53" r="4.2" fill="#3a2e33" />
      <circle cx="41.2" cy="51.6" r="1.3" fill="#fff" />
      <circle cx="61.2" cy="51.6" r="1.3" fill="#fff" />
      <path d="M47 60 L53 60 L50 63.5 Z" fill="#f06f93" />
      <rect x="48" y="64" width="4" height="5" rx="1" fill="#fff" stroke="#e2d5da" strokeWidth="0.6" />
      <path d="M34 61 H17" stroke="#dcd2d6" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M66 61 H83" stroke="#dcd2d6" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  // 🐸 Frog — зелёная лягушка с глазами на макушке и широкой улыбкой
  frog: (
    <>
      <circle cx="34" cy="30" r="13" fill="#7ec850" />
      <circle cx="66" cy="30" r="13" fill="#7ec850" />
      <circle cx="34" cy="28" r="8" fill="#fff" />
      <circle cx="66" cy="28" r="8" fill="#fff" />
      <circle cx="34" cy="29" r="4" fill="#22311a" />
      <circle cx="66" cy="29" r="4" fill="#22311a" />
      <circle cx="50" cy="56" r="30" fill="#7ec850" />
      <ellipse cx="50" cy="66" rx="20" ry="14" fill="#a7dd7a" />
      <path d="M30 58 Q50 77 70 58" stroke="#3f6b25" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <circle cx="46" cy="50" r="1.4" fill="#3f6b25" />
      <circle cx="54" cy="50" r="1.4" fill="#3f6b25" />
      <circle cx="32" cy="60" r="4" fill="#f3899a" opacity="0.6" />
      <circle cx="68" cy="60" r="4" fill="#f3899a" opacity="0.6" />
    </>
  ),
  // 🐧 Penguin — чёрно-белый пингвин с оранжевым клювом и лапками
  penguin: (
    <>
      <ellipse cx="50" cy="54" rx="32" ry="34" fill="#2b2f38" />
      <ellipse cx="50" cy="64" rx="20" ry="22" fill="#f4f1ea" />
      <ellipse cx="42" cy="42" rx="5" ry="6" fill="#f4f1ea" />
      <ellipse cx="58" cy="42" rx="5" ry="6" fill="#f4f1ea" />
      <circle cx="43" cy="43" r="2.6" fill="#2b2f38" />
      <circle cx="57" cy="43" r="2.6" fill="#2b2f38" />
      <path d="M45 49 L55 49 L50 57 Z" fill="#f5a623" />
      <ellipse cx="41" cy="87" rx="7" ry="3.5" fill="#f5a623" />
      <ellipse cx="59" cy="87" rx="7" ry="3.5" fill="#f5a623" />
    </>
  ),
  // 🐹 Hamster — теперь своя картинка (см. PET_IMG ниже), поэтому SVG-версия убрана.
};

// Питомцы с готовой картинкой (PNG/JPG из public/). Приоритетнее SVG.
// Файлы в public/ отдаются с корня сайта, поэтому путь начинается со «/».
const PET_IMG: Record<string, string> = {
  hamster: "/hamster.png",
  cat: "/cat.png",
  dog: "/dog.png",
  rabbit: "/rabbit.png",
  frog: "/frog.png",
  fox: "/fox.png",
  panda: "/panda.png",
  penguin: "/penguin.png",
  owl: "/owl.png",
  lion: "/lion.png",
  unicorn: "/unicorn.png",
  dragon: "/dragon.png",
  tiger: "/tiger.png",
  dino: "/dino.png",
};

// Показать питомца: своя картинка → кастомный SVG → эмодзи (фолбэк).
export function PetArt({ species, size = 64, className }: { species: string; size?: number; className?: string }) {
  const img = PET_IMG[species];
  if (img) {
    return (
      <img
        className={className}
        src={img}
        width={size}
        height={size}
        alt={petById(species)?.label ?? species}
        style={{ display: "block", objectFit: "contain" }}
      />
    );
  }
  const art = PET_SVG[species];
  if (art) {
    return (
      <svg className={className} viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden style={{ display: "block" }}>
        {art}
      </svg>
    );
  }
  return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{petById(species)?.emoji ?? "🐾"}</span>;
}
