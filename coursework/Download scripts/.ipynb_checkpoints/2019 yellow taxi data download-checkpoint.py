# the following code script is adapted from 2021 Unimelb MAST30034 tutorial material

import os
from os.path import getsize
from urllib.request import urlretrieve

# specify the output directory
output_dir = "./Data/2019 yellow taxi data"

# template for the type of 2019 yellow taxi data
filename_template = 'yellow_tripdata_2019'

# obtain data from Jan to Dec
for m in range(1, 13):
    out = f'{filename_template}-{str(m).zfill(2)}.csv'
    url = f"https://s3.amazonaws.com/nyc-tlc/trip+data/{out}"
    urlretrieve(url, f"{output_dir}/{out}")
    
    print(f"Done downloading {out} to {output_dir} with size {getsize(f'{output_dir}/{out}') / 1073741824:.2f}GB")