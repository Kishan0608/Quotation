-- The signature printed above "Authorised Signatory" on quotation PDFs and Excel files.
-- Uploaded on Company settings; kept as a small PNG (data URL, white background made transparent).

alter table public.company_settings
  add column if not exists signature_image text
  check (signature_image is null or (signature_image like 'data:image/png;base64,%' and char_length(signature_image) <= 400000));
