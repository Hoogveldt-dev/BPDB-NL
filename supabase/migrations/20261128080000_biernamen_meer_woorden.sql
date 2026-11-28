-- Veel meer woorden voor de willekeurige spelersnamen (ruim 180 bijvoeglijke en ruim 180 zelfstandige naamwoorden,
-- samen ruim 30.000 combinaties), alles rond bier en de kroeg. De verbuiging blijft zoals in
-- 20261127150000_biernamen_verbuiging: een de-woord krijgt de e-vorm (koele pul), een het-woord de grondvorm
-- (koel pilsje). Bestaande namen en zelfgekozen namen blijven staan.

create or replace function private.willekeurige_naam()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- grondvorm (voor het-woorden) en e-vorm (voor de-woorden), op dezelfde plek in beide lijsten
  adj_grond text[] := array[
    'dorstig', 'schuimend', 'fris', 'gouden', 'bruisend', 'koel', 'blond', 'donker', 'hoppig', 'moutig',
    'bitter', 'troebel', 'helder', 'vol', 'droog', 'zoet', 'stevig', 'licht', 'ijskoud', 'vers', 'gezellig',
    'lekker', 'romig', 'krachtig', 'fruitig', 'kruidig', 'zuiver', 'rijk', 'bruin', 'pittig', 'mild', 'zacht',
    'vurig', 'geurig', 'gul', 'mooi', 'trots', 'getapt', 'gerijpt', 'gefilterd', 'gistend', 'rijp', 'jong',
    'oud', 'goudgeel', 'koperen', 'rokerig', 'vrolijk', 'tevreden', 'stoer', 'dapper', 'vlot', 'trouw',
    'wijs', 'zuinig', 'zonnig', 'kalm', 'rustig', 'snel', 'eerlijk', 'roodbruin', 'zwart', 'wit', 'rood',
    'geel', 'oranje', 'bleek', 'diep', 'zurig', 'scherp', 'hartig', 'bloemig', 'tropisch', 'sappig', 'rond',
    'strak', 'volmondig', 'smaakvol', 'complex', 'elegant', 'lieflijk', 'machtig', 'robuust', 'lauw', 'koud',
    'ijzig', 'bevroren', 'gekoeld', 'gebrouwen', 'gebotteld', 'gevuld', 'overvol', 'halfvol', 'leeg',
    'schuimig', 'luchtig', 'dik', 'dun', 'slank', 'lang', 'klein', 'groot', 'hoog', 'laag', 'gastvrij',
    'warm', 'luid', 'rumoerig', 'levendig', 'joviaal', 'sociaal', 'lachend', 'zingend', 'dansend',
    'proostend', 'klinkend', 'laat', 'vroeg', 'vast', 'bekend', 'beroemd', 'oeroud', 'klassiek', 'echt',
    'puur', 'lokaal', 'belgisch', 'brabants', 'duits', 'engels', 'iers', 'hollands', 'limburgs', 'gelders',
    'perfect', 'prima', 'geweldig', 'heerlijk', 'subliem', 'fijn', 'puik', 'prachtig', 'royaal', 'ruim',
    'blij', 'gelukkig', 'opgewekt', 'uitgelaten', 'monter', 'lui', 'loom', 'bedaard', 'bescheiden', 'nuchter',
    'goudbruin', 'strogeel', 'zilveren', 'smakelijk', 'uitbundig', 'tintelend', 'zalig', 'toegewijd',
    'zwierig', 'dartel', 'flink', 'fors', 'sterk', 'zwaar', 'speciaal', 'zeldzaam', 'degelijk', 'deftig',
    'hip', 'gewoon', 'simpel', 'sober', 'sluw', 'handig', 'geduldig', 'kwiek', 'wakker', 'zoutig', 'heet',
    'glad', 'taai'];
  adj_e text[] := array[
    'dorstige', 'schuimende', 'frisse', 'gouden', 'bruisende', 'koele', 'blonde', 'donkere', 'hoppige',
    'moutige', 'bittere', 'troebele', 'heldere', 'volle', 'droge', 'zoete', 'stevige', 'lichte', 'ijskoude',
    'verse', 'gezellige', 'lekkere', 'romige', 'krachtige', 'fruitige', 'kruidige', 'zuivere', 'rijke',
    'bruine', 'pittige', 'milde', 'zachte', 'vurige', 'geurige', 'gulle', 'mooie', 'trotse', 'getapte',
    'gerijpte', 'gefilterde', 'gistende', 'rijpe', 'jonge', 'oude', 'goudgele', 'koperen', 'rokerige',
    'vrolijke', 'tevreden', 'stoere', 'dappere', 'vlotte', 'trouwe', 'wijze', 'zuinige', 'zonnige', 'kalme',
    'rustige', 'snelle', 'eerlijke', 'roodbruine', 'zwarte', 'witte', 'rode', 'gele', 'oranje', 'bleke',
    'diepe', 'zurige', 'scherpe', 'hartige', 'bloemige', 'tropische', 'sappige', 'ronde', 'strakke',
    'volmondige', 'smaakvolle', 'complexe', 'elegante', 'lieflijke', 'machtige', 'robuuste', 'lauwe', 'koude',
    'ijzige', 'bevroren', 'gekoelde', 'gebrouwen', 'gebottelde', 'gevulde', 'overvolle', 'halfvolle', 'lege',
    'schuimige', 'luchtige', 'dikke', 'dunne', 'slanke', 'lange', 'kleine', 'grote', 'hoge', 'lage',
    'gastvrije', 'warme', 'luide', 'rumoerige', 'levendige', 'joviale', 'sociale', 'lachende', 'zingende',
    'dansende', 'proostende', 'klinkende', 'late', 'vroege', 'vaste', 'bekende', 'beroemde', 'oeroude',
    'klassieke', 'echte', 'pure', 'lokale', 'belgische', 'brabantse', 'duitse', 'engelse', 'ierse',
    'hollandse', 'limburgse', 'gelderse', 'perfecte', 'prima', 'geweldige', 'heerlijke', 'sublieme', 'fijne',
    'puike', 'prachtige', 'royale', 'ruime', 'blije', 'gelukkige', 'opgewekte', 'uitgelaten', 'montere',
    'luie', 'lome', 'bedaarde', 'bescheiden', 'nuchtere', 'goudbruine', 'strogele', 'zilveren', 'smakelijke',
    'uitbundige', 'tintelende', 'zalige', 'toegewijde', 'zwierige', 'dartele', 'flinke', 'forse', 'sterke',
    'zware', 'speciale', 'zeldzame', 'degelijke', 'deftige', 'hippe', 'gewone', 'simpele', 'sobere', 'sluwe',
    'handige', 'geduldige', 'kwieke', 'wakkere', 'zoutige', 'hete', 'gladde', 'taaie'];
  de_woord text[] := array[
    'gerst', 'hop', 'mout', 'gist', 'schuimkraag', 'pul', 'kroes', 'tap', 'tapkraan', 'kurk', 'stamgast',
    'tapper', 'pint', 'brouwer', 'tripel', 'dubbel', 'stout', 'ipa', 'radler', 'kroeg', 'bokaal', 'tulp',
    'kroegtijger', 'bierpomp', 'proost', 'borrel', 'bierkaart', 'brouwerij', 'bierton', 'dorst', 'pils',
    'herberg', 'taverne', 'bierhal', 'bierkelder', 'biertuin', 'bierfles', 'bierdop', 'bierkast', 'bierpul',
    'brouwketel', 'mouterij', 'hopgaard', 'gerstakker', 'wort', 'tarwe', 'dop', 'kroegkat', 'stamtafel',
    'bar', 'barkruk', 'toog', 'tapkast', 'tapster', 'barman', 'barvrouw', 'ober', 'kastelein', 'waard',
    'herbergier', 'gastheer', 'gastvrouw', 'darttafel', 'dartpijl', 'pooltafel', 'jukebox', 'flipperkast',
    'schenkkan', 'karaf', 'parasol', 'terrasstoel', 'bitterbal', 'frikandel', 'kroket', 'portie',
    'schuimlaag', 'bubbel', 'tapbeurt', 'bierproever', 'cider', 'mede', 'abdij', 'trappist', 'saison',
    'kriek', 'lambiek', 'gueuze', 'porter', 'gose', 'kolsch', 'bock', 'biertap', 'bierkoeler', 'kroegbaas',
    'nachtkroeg', 'dorpskroeg', 'buurtkroeg', 'hoekkroeg', 'bierbaas', 'bierkenner', 'kroegzanger',
    'dorstlesser', 'pilsner', 'dubbelbock'];
  het_woord text[] := array[
    'pilsje', 'vaasje', 'fust', 'vaatje', 'bierviltje', 'dopje', 'rondje', 'bokbier', 'weizen', 'lager',
    'biertje', 'blondje', 'glas', 'vat', 'kratje', 'flesje', 'schuim', 'tapbier', 'tarwebier', 'terras',
    'fustje', 'halfje', 'wit', 'bruin', 'abdijbier', 'tafelbier', 'zomerbier', 'winterbier', 'herfstbier',
    'lentebier', 'kerstbier', 'paasbier', 'oktoberbier', 'fruitbier', 'kruidenbier', 'dubbeltje', 'tripeltje',
    'bier', 'proeflokaal', 'pubje', 'kroegje', 'bierhuis', 'brouwhuis', 'moutbier', 'hopje', 'moutje',
    'gistje', 'tapje', 'borreltje', 'hapje', 'kaasblokje', 'worstje', 'nootje', 'zoutje', 'biljart',
    'dartbord', 'dartspel', 'kaartspel', 'feestje', 'liedje', 'gezelschap', 'gelag', 'stamlokaal', 'lokaal',
    'bierglas', 'bierkrat', 'glaasje', 'pintje', 'pilsglas', 'tulpglas', 'kroegleven', 'kroeglied',
    'drinklied', 'feestlied', 'lagerbier', 'witbiertje', 'streekbier', 'huisbier', 'vatbier', 'schuimbier',
    'mokkabier', 'gerstenat'];
  kandidaat text;
  basis text;
  n integer := 1;
  a integer;
  z integer;
  aantal_de integer := array_length(de_woord, 1);
  aantal_het integer := array_length(het_woord, 1);
begin
  for poging in 1..60 loop
    a := 1 + floor(random() * array_length(adj_grond, 1))::int;
    z := 1 + floor(random() * (aantal_de + aantal_het))::int;
    if z <= aantal_de then
      basis := adj_e[a] || '-' || de_woord[z];
    else
      basis := adj_grond[a] || '-' || het_woord[z - aantal_de];
    end if;
    if char_length(basis) <= 21 and not exists (select 1 from public.profielen p where lower(p.naam) = basis) then
      return basis;
    end if;
  end loop;
  basis := adj_grond[1] || '-' || het_woord[1];
  kandidaat := basis;
  while exists (select 1 from public.profielen p where lower(p.naam) = kandidaat) loop
    n := n + 1;
    kandidaat := basis || n::text;
  end loop;
  return kandidaat;
end;
$$;

revoke execute on function private.willekeurige_naam() from public, anon, authenticated;
