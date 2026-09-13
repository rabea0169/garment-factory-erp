import {
  containsAr,
  containsVariants,
  expandQueryVariants,
  matchRank,
  normalizeArabicText,
  startsWithAr,
  wordStartsAr,
} from './arabic-search.util';

/**
 * SELIM-ERP W3 — اختبارات محرك البحث العربي (نقل سلوك اختبارات T57/T62
 * من Selim ERP نفسها — نفس الحالات المثبّتة هناك).
 */

describe('arabic-search — normalizeArabicText', () => {
  it('يوحّد الهمزات (أ/إ/آ/ٱ → ا)', () => {
    expect(normalizeArabicText('أحمد')).toBe('احمد');
    expect(normalizeArabicText('إبراهيم')).toBe('ابراهيم');
    expect(normalizeArabicText('آمنة')).toBe('امنه');
  });

  it('يوحّد ى/ئ → ي و ة → ه و ؤ → و', () => {
    expect(normalizeArabicText('عليى')).toBe('عليي');
    expect(normalizeArabicText('حمزة')).toBe('حمزه');
    expect(normalizeArabicText('ؤ')).toBe('و');
  });

  it('يزيل التشكيل والتطويل ويضغط الفراغات', () => {
    expect(normalizeArabicText('مُحَمَّد')).toBe('محمد');
    expect(normalizeArabicText('تيــشيرت')).toBe('تيشيرت');
    expect(normalizeArabicText('محمد   احمد')).toBe('محمد احمد');
  });

  it('يحوّل الأرقام الهندية/الفارسية لغربية ويصغّر الإنجليزية', () => {
    expect(normalizeArabicText('٠١٢٣')).toBe('0123');
    expect(normalizeArabicText('۹۸')).toBe('98');
    expect(normalizeArabicText('T-Shirt')).toBe('t-shirt');
  });

  it('يتعامل مع null/undefined بأمان', () => {
    expect(normalizeArabicText(null)).toBe('');
    expect(normalizeArabicText(undefined)).toBe('');
  });
});

describe('arabic-search — المطابقات', () => {
  it('startsWithAr: بداية النص بعد التطبيع', () => {
    expect(startsWithAr('مح', 'محمد احمد')).toBe(true);
    expect(startsWithAr('مح', 'أحمد محمد')).toBe(false);
  });

  it('wordStartsAr: حدود الكلمة الحقيقية', () => {
    expect(wordStartsAr('احمد', 'أ/احمد الغمراوي')).toBe(true);
    expect(wordStartsAr('احمد', 'محمد احمد')).toBe(true);
    expect(wordStartsAr('احمد', 'محمد-احمد')).toBe(true);
    expect(wordStartsAr('ابو', 'احمد (ابو محمد)')).toBe(true);
    // منتصف الكلمة ليس بداية كلمة
    expect(wordStartsAr('لا', 'اسلام')).toBe(false);
  });

  it('wordStartsAr: الأرقام بعد فاصل بداية كلمة', () => {
    expect(wordStartsAr('20', 'سوستة 20 سم')).toBe(true);
    expect(wordStartsAr('سم', 'سوستة 20 سم')).toBe(true);
  });

  it('wordStartsAr: التطبيع الذكي (احمد ↔ أحمد ↔ آحمد)', () => {
    expect(wordStartsAr('احمد', 'آحمد عبد الله')).toBe(true);
  });

  it('containsAr: يحتوي بعد التطبيع', () => {
    expect(containsAr('012', '٠١٢٣٤٥٦٧٨٩')).toBe(true);
    expect(containsAr('حمد', 'أحمد')).toBe(true);
  });
});

describe('arabic-search — matchRank', () => {
  it('0 للبداية، 1 لكلمة داخلية، 2 لغير ذلك', () => {
    expect(matchRank('احمد', 'احمد محمد')).toBe(0);
    expect(matchRank('احمد', 'محمد احمد')).toBe(1);
    expect(matchRank('احمد', 'محمد الاحمدية')).toBe(2);
  });

  it('الاستعلام الفارغ يرجع 0', () => {
    expect(matchRank('', 'أي نص')).toBe(0);
  });
});

describe('arabic-search — expandQueryVariants', () => {
  it('يوسّع الهمزات (احمد يشمل أحمد/إحمد/آحمد)', () => {
    const variants = expandQueryVariants('احمد');
    expect(variants).toContain('احمد');
    expect(variants).toContain('أحمد');
    expect(variants).toContain('إحمد');
    expect(variants).toContain('آحمد');
  });

  it('الاستعلام الفارغ يعيد قائمة فارغة', () => {
    expect(expandQueryVariants('')).toEqual([]);
    expect(expandQueryVariants('   ')).toEqual([]);
  });

  it('النص كما كتبه المستخدم يبقى ضمن المتغيرات (بلا تطبيع حروف)', () => {
    // stripQueryLight يحافظ على «أحمد» كما هي بجانب النسخة المطبّعة
    const variants = expandQueryVariants('أحمد');
    expect(variants).toContain('أحمد');
    expect(variants).toContain('احمد');
  });
});

describe('arabic-search — containsVariants', () => {
  it('الأرقام الهندية تضيف نسخة غربية', () => {
    expect(containsVariants('٠١٠')).toEqual(['٠١٠', '010']);
  });

  it('الإنجليزية الكبيرة تضيف نسخة صغيرة (سلوك Selim نفسه)', () => {
    expect(containsVariants('SO-0001')).toEqual(['SO-0001', 'so-0001']);
  });

  it('النص الصغير الخالص يعيد نفسه فقط', () => {
    expect(containsVariants('so-0001')).toEqual(['so-0001']);
  });

  it('الفراغ/الفارغ يعيد قائمة فارغة', () => {
    expect(containsVariants('')).toEqual([]);
    expect(containsVariants('  ')).toEqual([]);
  });
});
