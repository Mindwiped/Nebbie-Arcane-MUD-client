-- Esporta la mappa di Mudlet in JSON per Nebbie Client.
--
-- Uso:
--   1. In Mudlet apri l'editor Script, crea uno script "Esporta mappa" e incolla questo file.
--   2. Salva (lo script si attiva subito).
--   3. Scrivi nel client:  esporta mappa
--   4. Il file finisce in <cartella profilo>/mappa_nebbie.json (il percorso viene stampato).
--   5. Passa il file a Nebbie Client: "Importa mappa Mudlet (JSON)".
--
-- Ogni funzione dell'API mappa è chiamata con pcall: se una versione di Mudlet non la ha,
-- quel campo resta vuoto invece di bloccare l'esportazione.

local function prova(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c = pcall(fn, ...)
  if ok then return a, b, c end
  return nil
end

local function chiaviStringa(t)
  local r = {}
  if type(t) ~= "table" then return r end
  for k, v in pairs(t) do r[tostring(k)] = v end
  return r
end

function esportaMappaNebbie()
  local aree = {}
  for nome, id in pairs(prova(getAreaTable) or {}) do
    aree[#aree + 1] = {
      id = id,
      nome = nome,
      userData = chiaviStringa(prova(getAllAreaUserData, id)),
    }
  end

  local stanze = {}
  local n = 0
  for id, nome in pairs(prova(getRooms) or {}) do
    id = tonumber(id)
    local x, y, z = prova(getRoomCoordinates, id)
    stanze[#stanze + 1] = {
      id = id,
      nome = nome,
      area = prova(getRoomArea, id),
      x = x, y = y, z = z,
      uscite = chiaviStringa(prova(getRoomExits, id)),          -- direzione -> id
      usciteSpeciali = chiaviStringa(prova(getSpecialExitsSwap, id)), -- comando -> id
      porte = chiaviStringa(prova(getDoors, id)),               -- dir -> 1 aperta, 2 chiusa, 3 a chiave
      pesiUscite = chiaviStringa(prova(getExitWeights, id)),
      peso = prova(getRoomWeight, id),
      bloccata = prova(roomLocked, id) or false,
      ambiente = prova(getRoomEnv, id),
      simbolo = prova(getRoomChar, id),
      hash = prova(getRoomHashByID, id),
      userData = chiaviStringa(prova(getAllRoomUserData, id)),  -- firma, desc, vicini, porta_*, chiave_*, fermata…
    }
    n = n + 1
  end

  local dati = {
    formato = "nebbie-client/mudlet-map",
    versione = 1,
    esportatoIl = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    mappaUserData = chiaviStringa(prova(getAllMapUserData)),
    aree = aree,
    stanze = stanze,
  }

  local percorso = getMudletHomeDir() .. "/mappa_nebbie.json"
  local f, err = io.open(percorso, "w")
  if not f then
    cecho("\n<red>Esportazione fallita: " .. tostring(err) .. "\n")
    return
  end
  f:write(yajl.to_string(dati))
  f:close()
  cecho(string.format("\n<green>Mappa esportata: %d stanze, %d aree\n<white>%s\n", n, #aree, percorso))
end

if esportaMappaAlias then killAlias(esportaMappaAlias) end
esportaMappaAlias = tempAlias("^esporta mappa$", [[esportaMappaNebbie()]])
