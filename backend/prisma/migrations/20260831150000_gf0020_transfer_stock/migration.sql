-- GF-0020: Transfer is an auditable stock movement between warehouses.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = '"StockMovementType"'::regtype
      AND enumlabel = 'TRANSFER'
  ) THEN
    ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER';
  END IF;
END
$$;
