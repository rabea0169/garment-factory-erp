/**
 * SELIM-ERP W3 — محرك البحث العربي الموحد (نقل من lib/arabic-search.ts
 * في Selim ERP: نفس الدوال والسلوك المثبّت باختبارات T57/T62 هناك).
 *
 * المشكلة التي يحلها: المستخدم يكتب «احمد» والقاعدة تخزن «أحمد»، أو يكتب
 * «٠١٢٣» والتليفون مخزن «0123»، أو يبحث بكلمة داخلية فيطابقها «بداية كلمة»
 * فقط لا وسط الكلمة. التطبيع + المتغيرات الإملائية + حدود الكلمة تعالج
 * كل ذلك.
 *
 * الطبقات:
 * 1) التطبيع الكامل (normalizeArabicText) — للمطابقة في الذاكرة والترتيب.
 * 2) المتغيرات الإملائية (expandQueryVariants) — لشروط Prisma لأن الخادم
 *    لا يطبّع المخزون: «احمد» يتوسع إلى أحمد/إحمد/آحمد… فتطابق البداية.
 * 3) بناة الشروط (namePrefixConditions / containsFieldConditions) — يركّبون
 *    شروط OR جاهزة لكل حقل.
 */

/** تشكيل + شدّة + سكون + تطويل (ـ) + سواكن صغيرة. */
const DIACRITICS_RE = /[\u064B-\u0655\u0670\u0640]/g;
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** عائلات الحروف التي تُكتب بأشكال مختلفة وتُقرأ نفسًا. */
const VARIANT_FAMILIES: string[][] = [
  ['ا', 'أ', 'إ', 'آ', 'ٱ'],
  ['ي', 'ى', 'ئ'],
  ['ه', 'ة'],
  ['و', 'ؤ'],
];

/** حد أقصى للمتغيرات حتى لا ينفجر شرط OR مع كلمات طويلة. */
const MAX_VARIANTS = 24;

/** فواصل تُعتبر بداية كلمة في النص المخزّن (ألقاب «أ/احمد»، «سوستة-20»…). */
const WORD_SEPARATORS = [' ', '/', '-', '(', '.', '،', '_'];

/** تطبيع كامل: تشكيل + همزات + نقاط + أرقام هندية + فراغات — idempotent. */
export function normalizeArabicText(
  input: string | number | null | undefined,
): string {
  if (input === null || input === undefined) return '';
  let s = String(input).toLowerCase();
  s = s.replace(DIACRITICS_RE, '');
  s = s.replace(/[٠-٩]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    return i >= 0 ? String(i) : d;
  });
  s = s.replace(/[۰-۹]/g, (d) => {
    const i = PERSIAN_DIGITS.indexOf(d);
    return i >= 0 ? String(i) : d;
  });
  s = s.replace(/[أإآٱ]/g, 'ا');
  s = s.replace(/[ىئ]/g, 'ي');
  s = s.replace(/ة/g, 'ه');
  s = s.replace(/ؤ/g, 'و');
  return s.replace(/\s+/g, ' ').trim();
}

/** إزالة التشكيل/الأرقام الهندية فقط مع إبقاء الحروف كما كتبها المستخدم. */
function stripQueryLight(q: string): string {
  return String(q || '')
    .toLowerCase()
    .replace(DIACRITICS_RE, '')
    .replace(/[٠-٩]/g, (d) => {
      const i = ARABIC_DIGITS.indexOf(d);
      return i >= 0 ? String(i) : d;
    })
    .replace(/[۰-۹]/g, (d) => {
      const i = PERSIAN_DIGITS.indexOf(d);
      return i >= 0 ? String(i) : d;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** تهريب رموز regex حتى لا تنكسر المطابقة بمدخلات مثل «(50)». */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** هل يبدأ النص (بعد التطبيع) بالاستعلام؟ — الاستعلام الفارغ يطابق الكل. */
export function startsWithAr(
  query: string,
  text: string | number | null | undefined,
): boolean {
  const q = normalizeArabicText(query);
  if (!q) return true;
  return normalizeArabicText(text).startsWith(q);
}

/** بداية النص أو بداية أي كلمة فيه: «احمد» يطابق «احمد سيد» و«محمد احمد». */
export function wordStartsAr(
  query: string,
  text: string | number | null | undefined,
): boolean {
  const q = normalizeArabicText(query);
  if (!q) return true;
  const t = normalizeArabicText(text);
  if (t.startsWith(q)) return true;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(q)}`, 'u').test(t);
}

/** يحتوي (بعد التطبيع) — للأرقام/الهواتف/الباركود. */
export function containsAr(
  query: string,
  text: string | number | null | undefined,
): boolean {
  const q = normalizeArabicText(query);
  if (!q) return true;
  return normalizeArabicText(text).includes(q);
}

/**
 * ترتيب المطابقة: 0 = الاسم يبدأ بالاستعلام، 1 = كلمة داخلية تبدأ به،
 * 2 = غير ذلك. استخدم مع sort: الأصغر أولًا (نفس matchRank في Selim).
 */
export function matchRank(
  query: string,
  text: string | number | null | undefined,
): number {
  const q = normalizeArabicText(query);
  if (!q) return 0;
  const t = normalizeArabicText(text);
  if (t.startsWith(q)) return 0;
  if (wordStartsAr(query, text)) return 1;
  return 2;
}

/**
 * يولّد متغيرات إملائية للاستعلام (احمد/أحمد/إحمد/آحمد…) بحيث تطابق
 * startsWith/contains النص المخزّن بأي إملاء — الخادم لا يطبّع المخزون.
 */
export function expandQueryVariants(rawQuery: string): string[] {
  const base = normalizeArabicText(rawQuery);
  if (!base) return [];

  const variants = new Set<string>([base]);
  const asTyped = stripQueryLight(rawQuery);
  if (asTyped) variants.add(asTyped);

  const queue: string[] = Array.from(variants);
  while (queue.length > 0 && variants.size < MAX_VARIANTS) {
    const current = queue.shift() as string;
    for (let i = 0; i < current.length; i++) {
      const family = VARIANT_FAMILIES.find((f) => f.includes(current[i]));
      if (!family) continue;
      for (const alt of family) {
        if (alt === current[i]) continue;
        const candidate = current.slice(0, i) + alt + current.slice(i + 1);
        if (!variants.has(candidate) && variants.size < MAX_VARIANTS) {
          variants.add(candidate);
          queue.push(candidate);
        }
      }
    }
  }
  return Array.from(variants).filter((v) => v.length > 0);
}

/**
 * متغيرات الاستعلام لحقول المحتوى (هاتف/باركود/رقم مستند): النص كما
 * كتبه المستخدم + نسخة بأرقام غربية — كتابة «٠١٠» تجد «010…».
 */
export function containsVariants(rawQuery: string): string[] {
  const raw = String(rawQuery ?? '').trim();
  if (!raw) return [];
  const western = stripQueryLight(raw);
  const out: string[] = [raw];
  if (western && western !== raw) out.push(western);
  return out;
}

/** فلتر Prisma لقيمة واحدة (startsWith أو contains + insensitive). */
export interface PrismaTextFilter {
  startsWith?: string;
  contains?: string;
  mode?: 'insensitive';
}

/**
 * شروط بحث «بالبداية» لحقل أسماء واحد على الخادم — لكل متغير إملائي:
 * بداية النص أو بداية كلمة بعد فاصل. تُدمج داخل OR للمستدعي.
 */
export function namePrefixConditions<W extends object>(
  field: string,
  rawQuery: string,
): W[] {
  const variants = expandQueryVariants(rawQuery);
  const conditions: W[] = [];
  for (const v of variants) {
    conditions.push({
      [field]: { startsWith: v, mode: 'insensitive' },
    } as W);
    for (const sep of WORD_SEPARATORS) {
      conditions.push({ [field]: { contains: `${sep}${v}` } } as W);
    }
  }
  return conditions;
}

/**
 * شروط بحث «يحتوي» لحقل واحد — النص كما كُتب + نسخة الأرقام الغربية.
 * يُستخدم بدل { field: { contains: q } } الخام.
 */
export function containsFieldConditions<W extends object>(
  field: string,
  rawQuery: string,
  insensitive = true,
): W[] {
  return containsVariants(rawQuery).map(
    (v) =>
      ({
        [field]: insensitive
          ? { contains: v, mode: 'insensitive' }
          : { contains: v },
      }) as W,
  );
}
