# Foundation / Icons / Button
- Files src/components/icons.tsx, src/components/ui/button.tsx, src/app/layout.tsx, src/app/globals.css.
- Fonts: 원본 @font-face의 Pretendard400..800 unicode subset30개 + GeistMono 로컬woff; 원본 fontface가 unicode-range를 유지하도록 CSS에서 참조.
- 원본 CSS fullasset는 public/clone/original.css. 타깃의 Tailwind3 compiledCSS를 유지하고 Tailwind4는 새 Button primitive에만 scope한다. 전체snapshot class를 v4재생성하면 translate 등 property의 의미가 달라지는 것을 QA에서 발견하여 source(none) 적용.
- foreground31/backgroundwhite/primary31/border230/muted110/sidebar hsl36 9%95%,radius8; 실제 computed tokens docs/research/tokens.json.
- Inline SVG는 캡처 그대로 React변환, 신규 공통svg는 lucide icons export. LogoIcon fallback은 원본 lightning 형태.
- shadcn Button primitive Slot+cva, disabled/hover/focus, 32/36px높이; 새폼에만 사용.
- 폰트/assets가 로컬이므로 원본인증/API요청없음.
- Validation npm run build + 대표 screenshot비교.
