import json
import sys

# Read the raw OSM JSON
with open('osm_raw.json', 'r', encoding='utf-8-sig') as f:
    elements = json.load(f)

print(f"Total elements: {len(elements)}", file=sys.stderr)

# Manufacturer brand mapping (English brand tag -> Japanese)
BRAND_MAP = {
    'coca': 'コカ・コーラ',
    'suntory': 'サントリー',
    'dydo': 'ダイドー',
    'kirin': 'キリン',
    'asahi': 'アサヒ',
    'itoen': '伊藤園',
    'ito-en': '伊藤園',
    'pokka': 'ポッカサッポロ',
    'sapporo': 'ポッカサッポロ',
    'ucc': 'UCC',
    'sangaria': 'サンガリア',
    'otsuka': '大塚',
    'house': 'ハウス',
}

DRINK_MAP = {
    'drink:cola': 'コーラ',
    'drink:coffee': 'コーヒー',
    'drink:tea': 'お茶',
    'drink:water': '水',
    'drink:juice': 'ジュース',
    'drink:energy_drink': 'エナジードリンク',
    'drink:sports_drink': 'スポーツドリンク',
    'drink:milk': '牛乳',
    'drink:chocolate_milk': 'ミルクティー',
}

def detect_manufacturer(tags):
    brand_en = (tags.get('brand:en', '') + ' ' + tags.get('operator:en', '')).lower()
    for key, name in BRAND_MAP.items():
        if key in brand_en:
            return name
    # Try Japanese brand tag
    brand_ja = tags.get('brand:ja', '') or tags.get('brand', '') or tags.get('operator', '')
    if brand_ja and not all(c.isascii() for c in brand_ja):
        return brand_ja
    return '不明'

def make_name(tags, osm_id, mfg):
    if tags.get('name:ja'):
        return tags['name:ja']
    name = tags.get('name', '')
    if name and not name.replace('-', '').replace(' ', '').isascii():
        return name
    if mfg != '不明':
        return f'{mfg} 自販機'
    return f'自販機 (OSM:{osm_id})'

def make_payments(tags):
    payments = []
    if tags.get('payment:coins') != 'no':
        payments.append('現金')
    if (tags.get('payment:suica') == 'yes' or
        tags.get('payment:ic_card') == 'yes' or
        tags.get('payment:contactless') == 'yes' or
        tags.get('payment:mastercard') == 'yes'):
        payments.append('交通系IC')
    if tags.get('payment:credit_cards') == 'yes':
        payments.append('クレジットカード')
    if tags.get('payment:paypay') == 'yes' or tags.get('payment:qr_code') == 'yes':
        payments.append('PayPay')
    if not payments:
        payments.append('現金')
    return payments

def make_lineup(tags):
    lineup = []
    for tag, name in DRINK_MAP.items():
        if tags.get(tag) == 'yes':
            lineup.append(name)
    return lineup

def make_last_updated(tags):
    if tags.get('check_date'):
        return tags['check_date'].replace('-', '/')
    if tags.get('survey:date'):
        return tags['survey:date'].replace('-', '/')
    return '不明'

spots = []
for i, el in enumerate(elements, start=1):
    tags = el.get('tags', {})
    lat = el['lat']
    lng = el['lon']
    osm_id = el['id']

    mfg = detect_manufacturer(tags)
    name = make_name(tags, osm_id, mfg)
    payments = make_payments(tags)
    lineup = make_lineup(tags)
    last_updated = make_last_updated(tags)
    trash = 'あり' if tags.get('waste_basket') == 'yes' else 'なし'

    spot = {
        'id': i,
        'name': name,
        'lat': lat,
        'lng': lng,
        'manufacturer': mfg,
        'rating': 3.0,
        'priceRange': '不明',
        'hasTrashBin': trash,
        'paymentMethods': payments,
        'rarity': 1,
        'lineup': lineup,
        'description': '',
        'type': 'standard',
        'photos': [],
        'verifiedCount': 0,
        'lastUpdated': last_updated,
        'osmId': osm_id,
        'namingRightsAvailable': True,
        'owner': None,
        'comments': []
    }
    spots.append(spot)

# Write as JS module
lines = ['export const initialSpots = [']
for idx, spot in enumerate(spots):
    comma = ',' if idx < len(spots) - 1 else ''
    # Convert Python True/False/None to JS true/false/null
    def to_js(v):
        if v is True: return 'true'
        if v is False: return 'false'
        if v is None: return 'null'
        if isinstance(v, str): return json.dumps(v, ensure_ascii=False)
        if isinstance(v, list):
            return '[' + ', '.join(to_js(x) for x in v) + ']'
        return str(v)

    entry_lines = [
        '    {',
        f'        id: {spot["id"]},',
        f'        name: {json.dumps(spot["name"], ensure_ascii=False)},',
        f'        lat: {spot["lat"]},',
        f'        lng: {spot["lng"]},',
        f'        manufacturer: {json.dumps(spot["manufacturer"], ensure_ascii=False)},',
        f'        rating: {spot["rating"]},',
        f'        priceRange: {json.dumps(spot["priceRange"], ensure_ascii=False)},',
        f'        hasTrashBin: {json.dumps(spot["hasTrashBin"], ensure_ascii=False)},',
        f'        paymentMethods: {to_js(spot["paymentMethods"])},',
        f'        rarity: {spot["rarity"]},',
        f'        lineup: {to_js(spot["lineup"])},',
        f'        description: "",',
        f'        type: "standard",',
        f'        photos: [],',
        f'        verifiedCount: 0,',
        f'        lastUpdated: {json.dumps(spot["lastUpdated"], ensure_ascii=False)},',
        f'        osmId: {spot["osmId"]},',
        f'        namingRightsAvailable: true,',
        f'        owner: null,',
        f'        comments: []',
        f'    }}{comma}',
    ]
    lines.extend(entry_lines)

lines.append('];')

output = '\n'.join(lines) + '\n'
with open('data.js', 'w', encoding='utf-8') as f:
    f.write(output)

print(f"Written {len(spots)} spots to data.js", file=sys.stderr)
