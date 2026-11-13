import arabic400 from '@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff2?inline';
import arabic700 from '@fontsource/vazirmatn/files/vazirmatn-arabic-700-normal.woff2?inline';
import latin400 from '@fontsource/vazirmatn/files/vazirmatn-latin-400-normal.woff2?inline';
import latin700 from '@fontsource/vazirmatn/files/vazirmatn-latin-700-normal.woff2?inline';

export const FONT_CSS = [400, 700].map((weight, index) => `
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:${weight};font-display:swap;src:url('${[arabic400, arabic700][index]}') format('woff2');unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+FB50-FDFF,U+FE70-FEFF}
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:${weight};font-display:swap;src:url('${[latin400, latin700][index]}') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
`).join('');
