-- Campos para el envio manual del mail con el material (fotos y videos) via Zoho:
-- client_email: destinatario del mail.
-- link_sent_at: cuando se envio el mail (dispara el boton "Enviar material" en la ficha
-- del cliente). El material queda disponible en Drive hasta 180 dias despues de esta fecha;
-- el borrado real en Drive lo sigue haciendo Pablo a mano, esto solo lo informa en el mail.
alter table public.clients
  add column if not exists client_email text,
  add column if not exists link_sent_at timestamptz;
