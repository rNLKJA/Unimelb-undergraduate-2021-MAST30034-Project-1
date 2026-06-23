# MAST30034 Project 1 - Quantitative Analysis
- Student Name: Sunchuangyu Huang
- Student ID: 1118472
- Due Date: Friday 16th of August 11:59:00 am (AEST).
- Report Link: [Overleaf](https://www.overleaf.com/read/jtyhjwsdsvcn) (view only)

The original git repo link is https://github.com/MAST30034-2021-S2/mast30034_2021_s2_project_1-chuangyu-hscy.

You may need authorised by MAST30034 tut group to access it.

# Dependencies
- Language: _i.e Python 3.8.3 and/or R 4.05_
- Packages / Libraries: check requirements.txt

# Datasets
- NYC TLC: https://www1.nyc.gov/site/tlc/about/tlc-trip-record-data.page
- New York Weather Summary: https://www.ncdc.noaa.gov/cdo-web/
- New York Car Collision (Big Query): https://data.cityofnewyork.us/City-Government/NYC-Permitted-Event-Information-Historical/bkfu-528j
- NYC Permitted Event Information - Historical: https://data.cityofnewyork.us/City-Government/NYC-Permitted-Event-Information-Historical/bkfu-528j

# Directory
- `Data`: Contains all the raw data files. Some external data set will be uploaded, otherwise please use the download scripts below.
- `Preprocess`: Contains all the preprocessed data files. (e.g. pyspark staging file)
- `plot`: stores output plots
- `tmp`: this folder is used to store pyspark persist(StorageLevel.DISK_ONLY) file

# Other
- View README.md under Preprocess folder to get detailed proprocessing records.
- For external data downloading, please use the download scripts under /Download scripts folder.
- run init.py and library.py before other cells running
- make sure all dependencies are installed and all directories are valid.
- recommend use linux or WSL.
- when code executng the code, please check the SparkConf match the setting of the notebook.
