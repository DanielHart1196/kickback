-- Add merchant name to square_connections for display purposes.
ALTER TABLE square_connections
ADD COLUMN IF NOT EXISTS merchant_name text;
