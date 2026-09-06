import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * PROD-1 (ب): تحويل أخطاء Prisma المعروفة (P2025/P2003/P2002) إلى استجابات
 * HTTP عربية موحدة داخل GlobalExceptionFilter — حماية صافية لكل ما لم يعالجه
 * الموديولات بنفسها، مع الحفاظ على سلوك HttpException والأخطاء العامة.
 */

/** بناء ArgumentsHost وهمي يلتقط status/json كما تفعل Express. */
function createHost() {
  const json = jest.fn<void, [body: Record<string, unknown>]>();
  const status = jest.fn().mockReturnValue({ json });
  const request = {
    method: 'DELETE',
    url: '/api/products/bom/xyz',
    requestId: 'req-filter-1',
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, json }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

/** خطأ Prisma حقيقي من نفس صنف runtime العميل. */
function prismaKnownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(`Prisma error ${code}`, {
    code,
    clientVersion: 'test',
    ...(meta !== undefined ? { meta } : {}),
  });
}

describe('GlobalExceptionFilter — PROD-1(ب): تحويل أخطاء Prisma المعروفة', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  it('P2025 (السجل غير موجود) → 404 برسالة عربية موحدة', () => {
    const { host, status, json } = createHost();

    filter.catch(prismaKnownError('P2025'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-filter-1',
        statusCode: HttpStatus.NOT_FOUND,
        message: 'السجل المطلوب غير موجود',
        detail: { prismaCode: 'P2025' },
      }),
    );
  });

  it('P2003 (مفتاح أجنبي غير صالح) → 400 برسالة عربية موحدة', () => {
    const { host, status, json } = createHost();

    filter.catch(
      prismaKnownError('P2003', { field_name: 'rawMaterialId' }),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'مفتاح أجنبي غير صالح — السجل المرتبط غير موجود',
        detail: { prismaCode: 'P2003' },
      }),
    );
  });

  it('P2002 (تعارض قيد فريد) → 409 برسالة عربية موحدة', () => {
    const { host, status, json } = createHost();

    filter.catch(prismaKnownError('P2002', { target: ['code'] }), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        message: 'تعارض قيد فريد — القيمة مستخدمة مسبقًا',
        detail: { prismaCode: 'P2002' },
      }),
    );
  });

  it('كائن شبيه بخطأ Prisma (duck-typing عبر code) يُحوَّل بنفس الجدول', () => {
    const { host, status } = createHost();

    filter.catch({ code: 'P2025' }, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('خطأ Prisma بشفرة غير مُحوَّلة (مثل P2021) → 500 كما هو', () => {
    const { host, status } = createHost();

    filter.catch(prismaKnownError('P2021'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('خطأ غير Prisma → 500 كما هو (السلوك القائم بلا تحويل)', () => {
    const { host, status, json } = createHost();

    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-filter-1',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'boom',
      }),
    );
  });

  it('HttpException يمر بسلوكه القائم دون أي تحويل', () => {
    const { host, status, json } = createHost();

    filter.catch(new NotFoundException('المنتج غير موجود'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'المنتج غير موجود',
      }),
    );
  });

  it('استجابة التحويل تحمل requestId من الطلب وطابعًا زمنيًا', () => {
    const { host, json } = createHost();

    filter.catch(prismaKnownError('P2025'), host);

    // نتحقق من الحقول عبر جسم الاستجابة الملتقط مباشرة
    expect(json).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0][0];
    expect(body['requestId']).toBe('req-filter-1');
    expect(typeof body['timestamp']).toBe('string');
  });

  it('بلا requestId في الطلب يُولَّد واحد بديل (السلوك القائم)', () => {
    const json = jest.fn<void, [body: Record<string, unknown>]>();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
        getRequest: () => ({ method: 'GET', url: '/api/health' }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new HttpException('رفض', HttpStatus.FORBIDDEN), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    const body = json.mock.calls[0][0];
    expect(typeof body['requestId']).toBe('string');
    expect((body['requestId'] as string).length).toBeGreaterThan(0);
  });
});
