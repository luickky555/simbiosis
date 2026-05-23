/*
  ID do celular (da instalação)

  A gente cria um `device_id` só uma vez e salva no banco local.
  Depois, toda vez que chama a API, manda esse id no `X-Device-Id`.
*/

import { metaGet, metaSet } from "./banco_local.js";
import { uuidv4 } from "./utilitarios.js";

const KEY = "device_id";

/**
 * Pega o `device_id` dessa instalação (fica salvo no celular).
 */
export async function getDeviceId() {
  let id = await metaGet(KEY);
  if (id) return id;
  id = uuidv4();
  await metaSet(KEY, id);
  return id;
}
