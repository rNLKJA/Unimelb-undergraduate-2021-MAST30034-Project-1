import os
from os.path import getsize
from urllib.request import urlretrieve

url1 = "https://s3.amazonaws.com/nyc-tlc/misc/taxi+_zone_lookup.csv"
url2 = "https://s3.amazonaws.com/nyc-tlc/misc/taxi_zones.zip"

output_dir1 = "./Data/taxi_zone/taxi_zone_lookup.csv"
output_dir2 = "./Data/taxi_zone/taxi_zones.zip"

urlretrieve(url1, f"{output_dir1}")
urlretrieve(url1, f"{output_dir2}")
print("Done downloading taxi zone look up table and shape file")