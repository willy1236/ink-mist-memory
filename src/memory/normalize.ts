/**
 * 比對用的正規化：全形 ASCII 與全形空白轉半形、轉小寫、去前後空白。
 * 名稱、aliases、任務類型前綴與關鍵字的比對共用這一份。
 */
export function normalize(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase()
    .trim();
}
