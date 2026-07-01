import os
import json
import time
import urllib.parse
import requests
import math
import re

BOUNDING_BOXES = {
    "Sapporo": "43.03,141.30,43.08,141.38",
    "Sendai": "38.24,140.83,38.28,140.92",
    "Tokyo_Central": "35.60,139.60,35.75,139.80",
    "Tokyo_East": "35.60,139.80,35.75,140.00",
    "Yokohama": "35.40,139.58,35.55,139.68",
    "Nagoya": "35.12,136.85,35.20,136.95",
    "Kyoto": "34.97,135.72,35.05,135.80",
    "Osaka": "34.62,135.45,34.75,135.55",
    "Kobe": "34.65,135.15,34.72,135.25",
    "Hiroshima": "34.37,132.42,34.42,132.50",
    "Fukuoka": "33.55,130.35,33.62,130.45",
    "Naha": "26.19,127.65,26.24,127.72"
}

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

def distance_meters(lat1, lng1, lat2, lng2):
    # Simple equirectangular distance approximation
    dx = (lng1 - lng2) * 111000 * math.cos(math.radians((lat1 + lat2) / 2.0))
    dy = (lat1 - lat2) * 111000
    return math.sqrt(dx*dx + dy*dy)

def load_backup_spots():
    print("Loading custom spots from data_backup.js...")
    with open('data_backup.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Strip comments
    content = re.sub(r'//.*$', '', content, flags=re.MULTILINE)
    
    # Strip export statement
    content = re.sub(r'^export\s+const\s+initialSpots\s*=\s*', '', content)
    content = content.strip()
    if content.endswith(';'):
        content = content[:-1].strip()
        
    # Quote unquoted keys in JS object literals (e.g. id: -> "id":)
    content = re.sub(r'([\{\,]\s*)([a-zA-Z0-9_]+)(\s*\:)', r'\1"\2"\3', content)
    
    # Strip trailing commas before closing braces/brackets
    content = re.sub(r',\s*([\}\]])', r'\1', content)
    
    try:
        spots = json.loads(content)
        print(f"Successfully loaded {len(spots)} custom spots.")
        return spots
    except Exception as e:
        print("Parsing failed. Let's dump the cleaned text range around error to debug:")
        # Find where it went wrong
        import traceback
        traceback.print_exc()
        raise e

def fetch_osm_spots():
    all_elements = {}
    headers = {
        "User-Agent": "VendiMap/1.0"
    }
    
    for city, bbox in BOUNDING_BOXES.items():
        print(f"Fetching data for {city} ({bbox})...")
        query = f'[out:json][timeout:30];node["amenity"="vending_machine"]["vending"="drinks"]({bbox});out body;'
        encoded = urllib.parse.quote(query)
        url = f"https://overpass-api.de/api/interpreter?data={encoded}"
        
        try:
            r = requests.get(url, headers=headers, timeout=35)
            if r.status_code == 200:
                data = r.json()
                elements = data.get("elements", [])
                print(f"-> Found {len(elements)} elements in {city}.")
                for el in elements:
                    all_elements[el['id']] = el
            else:
                print(f"-> Overpass API returned status {r.status_code} for {city}")
        except Exception as e:
            print(f"-> Error fetching {city}: {e}")
        
        # Polite delay to avoid Overpass rate-limiting
        time.sleep(1.5)
        
    return list(all_elements.values())

def detect_manufacturer(tags):
    brand_en = (tags.get('brand:en', '') + ' ' + tags.get('operator:en', '')).lower()
    for key, name in BRAND_MAP.items():
        if key in brand_en:
            return name
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

def main():
    # 1. Load backup spots (IDs 1-400)
    custom_spots = load_backup_spots()
    
    # 2. Fetch OSM elements
    osm_elements = fetch_osm_spots()
    print(f"Total unique OSM elements retrieved: {len(osm_elements)}")
    
    # 3. Process OSM elements and merge
    merged_spots = list(custom_spots)
    next_id = len(custom_spots) + 1
    skipped_duplicates = 0
    added_osm = 0
    
    for el in osm_elements:
        tags = el.get('tags', {})
        lat = el['lat']
        lng = el['lon']
        osm_id = el['id']
        
        # Check duplicate against existing custom spots (within 15 meters)
        is_duplicate = False
        for cs in custom_spots:
            if distance_meters(lat, lng, cs['lat'], cs['lng']) < 15:
                is_duplicate = True
                break
        
        if is_duplicate:
            skipped_duplicates += 1
            continue
            
        mfg = detect_manufacturer(tags)
        name = make_name(tags, osm_id, mfg)
        payments = make_payments(tags)
        lineup = make_lineup(tags)
        last_updated = make_last_updated(tags)
        trash = 'あり' if tags.get('waste_basket') == 'yes' else 'なし'
        
        spot = {
            'id': next_id,
            'name': name,
            'lat': lat,
            'lng': lng,
            'manufacturer': mfg,
            'rating': 3.0,
            'priceRange': '不明',
            'hasTrashBin': trash,
            'paymentMethods': payments,
            'rarity': 0,
            'rarityVotesCount': 0,
            'rarityVotesSum': 0,
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
        merged_spots.append(spot)
        next_id += 1
        added_osm += 1
        
    print(f"Skipped {skipped_duplicates} OSM elements too close to custom spots.")
    print(f"Added {added_osm} new OSM spots.")
    print(f"Total spots in merged database: {len(merged_spots)}")
    
    # 4. Write as JS module
    lines = ['export const initialSpots = [']
    for idx, spot in enumerate(merged_spots):
        comma = ',' if idx < len(merged_spots) - 1 else ''
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
            f'        rarityVotesCount: {spot.get("rarityVotesCount", 0)},',
            f'        rarityVotesSum: {spot.get("rarityVotesSum", 0)},',
            f'        lineup: {to_js(spot["lineup"])},',
            f'        description: {json.dumps(spot.get("description", ""), ensure_ascii=False)},',
            f'        type: {json.dumps(spot.get("type", "standard"), ensure_ascii=False)},',
            f'        photos: {to_js(spot.get("photos", []))},',
            f'        verifiedCount: {spot.get("verifiedCount", 0)},',
            f'        lastUpdated: {json.dumps(spot["lastUpdated"], ensure_ascii=False)},',
            f'        osmId: {to_js(spot.get("osmId"))},',
            f'        namingRightsAvailable: {to_js(spot.get("namingRightsAvailable", True))},',
            f'        owner: {to_js(spot.get("owner"))},',
            f'        comments: {to_js(spot.get("comments", []))}',
            f'    }}{comma}',
        ]
        lines.extend(entry_lines)
        
    lines.append('];')
    
    output = '\n'.join(lines) + '\n'
    
    # Save a backup of current data.js first just in case
    if os.path.exists('data.js'):
        os.replace('data.js', 'data_osm_backup_tokyo.js')
        print("Backed up old data.js to data_osm_backup_tokyo.js")
        
    with open('data.js', 'w', encoding='utf-8') as f:
        f.write(output)
        
    print(f"SUCCESS: Written {len(merged_spots)} spots to data.js")

if __name__ == "__main__":
    main()
