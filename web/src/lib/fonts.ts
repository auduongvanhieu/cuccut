// Fonts usable for text overlays. All have Vietnamese glyphs on Google Fonts.
export const FONTS: { family: string; weight: number; label: string }[] = [
  { family: 'Be Vietnam Pro', weight: 700, label: 'Be Vietnam' },
  { family: 'Montserrat', weight: 800, label: 'Montserrat' },
  { family: 'Oswald', weight: 500, label: 'Oswald' },
  { family: 'Bangers', weight: 400, label: 'Bangers' },
  { family: 'Lobster', weight: 400, label: 'Lobster' },
  { family: 'Pacifico', weight: 400, label: 'Pacifico' },
  { family: 'Dancing Script', weight: 700, label: 'Dancing' },
  { family: 'Playfair Display', weight: 700, label: 'Playfair' },
  { family: 'Roboto Slab', weight: 600, label: 'Roboto Slab' },
]

export async function loadFont(family: string) {
  try {
    await Promise.all([
      document.fonts.load(`400 32px "${family}"`, 'Ăâ ệ'),
      document.fonts.load(`700 32px "${family}"`, 'Ăâ ệ'),
    ])
  } catch {
    /* offline: system fallback */
  }
}
