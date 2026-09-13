-- SELIM-ERP W3: إعدادات المصنع (صف واحد بمفتاح 'factory') + الأجهزة.
-- نقل من FactorySettings/Device في Selim ERP بمعمارية أحادية المستأجر.

-- CreateTable
CREATE TABLE "factory_settings" (
    "id" TEXT NOT NULL,
    "factoryName" TEXT NOT NULL,
    "factoryNameEn" TEXT,
    "slogan" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "commercialRegister" TEXT,
    "logo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'ج.م',
    "invoicePrefix" TEXT DEFAULT 'INV-',
    "invoiceFooter" TEXT,
    "defaultPaperSize" TEXT DEFAULT 'A4',
    "enableInvoiceQr" BOOLEAN NOT NULL DEFAULT true,
    "taxRate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lastBackupAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT,
    "userAgent" TEXT,
    "platform" TEXT,
    "language" TEXT,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "isMobile" BOOLEAN NOT NULL DEFAULT false,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_deviceId_key" ON "devices"("deviceId");

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE INDEX "devices_lastSeenAt_idx" ON "devices"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
