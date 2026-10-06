import os
from os.path import getsize
from urllib.request import urlretrieve

output_dir = "./Data/2019 permitted event/2019 events.csv"
urlretrieve("https://data.cityofnewyork.us/api/views/bkfu-528j/rows.csv?accessType=DOWNLOAD", f"{output_dir}")
print("Done downloading 2019 events.csv")