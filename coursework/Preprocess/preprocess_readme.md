# University of Melbourne MAST30034 Applied Data Science Semester 2 Project 1

This repository is creaeted for TLC taxi data analysis.

Please make sure all required dependencies are install before using the notebook.

Run `pip install -r requirements.txt` to install all requirements.

---

All required data are stored in Data, for datasets download please run via jupyter notbook or using download scripts under Download scripts folder.

---

To view the report, please visit [Overleaf]()

---

## Data preprocessing on 2019 Yellow Taxi Data

### First Preprocessing Round

Table of unique keys columns VendorID, Passenger_count, RatecodeID and payment_type:

| VendorID | Passenger_count | RatecodeID | payment_type |
| -------- | --------------- | ---------- | ------------ |
| 1        | 1               | 1          | 1            |
| 4        | 6               | 6          | 3            |
| 2        | 3               | 3          | 5            |
|          | 5               | 5          | 4            |
|          | 9               | 4          | 2            |
|          | 4               | 2          |              |
|          | 8               | 99         |              |
|          | 7               |            |              |
|          | 2               |            |              |
|          | 0               |            |              |

According to data dictionary for yellow taxi records May 1, 2018.
There are two vendor IDs, 1 and 2, there is a unknown value for vendor ID 4, it will be removed from the dataframe.

According to [New York City: Taxis &amp; Rental Cars](https://www.tripadvisor.com.au/Travel-g60763-s304/New-York-City:New-York:Taxis.And.Rental.Cars.html), yellow sedan taxi can take 4 passengers and mini van could take 5 passengers. Therefore, any passenger number is greater than 5 will be consider as abnormal value.

However, according to descriptive summary data:

|passenger_count|   count|
| ------------- | ------ |
|           null|  246601|
|              1|59108834|
|              6| 2039148|
|              3| 3583919|
|              5| 3398212|
|              9|     225|
|              4| 1709802|
|              8|     277|
|              7|     416|
|              2|12785787|
|              0| 1525798|

It looks like 6 number of passengers is a legit number, therefore consider remove null value, 0 passenger number and passenger number greate than to 6.

According to summary statistics for all columns:

|summary|          VendorID|tpep_pickup_datetime|tpep_dropoff_datetime|   passenger_count|     trip_distance|        RatecodeID|store_and_fwd_flag|      PULocationID|      DOLocationID|      payment_type|       fare_amount|            extra|            mta_tax|        tip_amount|       tolls_amount|improvement_surcharge|      total_amount|congestion_surcharge|
| ----- | ---------------- | ------------------ | ------------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | --------------- | ----------------- | ---------------- | ----------------- | ------------------- | ---------------- | ------------------ |
|  count|          84152418|            84399019|             84399019|          84152418|          84399019|          84152418|          84152418|          84399019|          84399019|          84152418|          84399019|         84399019|           84399019|          84399019|           84399019|             84399019|          84399019|            79543038|
|   mean|1.6454766516631762|                null|                 null|1.5626939442191667|3.0009277213280505|1.0612957075101515|              null|163.15761897659024|161.35274483462894| 1.289363224239142| 13.34399120077402|1.086596863051219|  0.494609843510148|2.1950641269889553|0.38283104463564377|   0.2986038972725178|19.124363231868188|  2.1881800277731407|
| stddev|0.4978746196020776|                null|                 null| 1.207917425667764| 8.091113794982272| 0.759542934176276|              null| 66.01603813256101| 70.25087854014987|0.4791325056800892|174.37490187136657|1.248593875593335|0.06728067086217758|15.657058091860547| 1.8172171523055136| 0.027900031220924635|184.08736168504933|  0.8373132137979482|
|    min|                 1| 2001-01-01 00:02:08|  2001-01-01 01:00:02|                 0|         -37264.53|                 1|                 N|                 1|                 1|                 1|           -1856.0|            -60.0|               -0.5|            -221.0|              -70.0|                 -0.3|           -1871.8|                -2.5|
|    25%|                 1|                null|                 null|                 1|              0.98|                 1|              null|               116|               107|                 1|               6.5|              0.0|                0.5|               0.0|                0.0|                  0.3|             11.15|                 2.5|
|    50%|                 2|                null|                 null|                 1|              1.63|                 1|              null|               162|               162|                 1|               9.5|              0.5|                0.5|              1.86|                0.0|                  0.3|             14.72|                 2.5|
|    75%|                 2|                null|                 null|                 2|              3.05|                 1|              null|               233|               233|                 2|              15.0|              2.5|                0.5|              2.95|                0.0|                  0.3|             20.75|                 2.5|
|    max|                 4| 2090-12-31 06:41:26|  2090-12-31 07:18:49|                 9|          45977.22|                99|                 Y|               265|               265|                 5|          943274.8|           535.38|             212.42|         141492.02|             3288.0|                  1.0|        1084772.17|                 4.5|

There are abnormal value of pickup datetime and dropoff datatime, filter out datetime not within 2019.

Remove all negative values from all attributes.

### Second Preprocessing Round

After the above processing process, groupby each categories.

It's obvious that there are some unreasonable travel fee data, hence need to remove from the dataset.

According to 3 random sampling datasets, the fare_amount attribute has a right skew distribution and extra attribute has a multi modal distribution.

It is hard to draw a outlier boundary for fare_amount, hence applied z-score outlier detection with z-score value 3, trying to retain max amount of data.

For extra, according to the group by data and boxplot, it looks like extra attribute has a small portion of extreme value

Check


Partial summary statistics:

|summary|    trip_distance|       fare_amount|             extra|        tip_amount|      tolls_amount|      total_amount|congestion_surcharge|
|-------|-----------------|------------------|------------------|------------------|------------------|------------------|--------------------|
|  count|         76486620|          76486620|          76486620|          76486620|          76486620|          76486620|            76486620|
|   mean|2.979664223886488|13.003219038963945|1.1150110684718444|2.1948682241416337|0.3430861110086012|18.909093098445233|  2.2239816650284716|
| stddev| 3.81152876570615|10.927142829218184|1.2515593337859199| 2.635320897046094|  1.55943115900408|13.560242991479958|  0.7834854765929999|
|    min|             0.01|              0.01|               0.0|               0.0|               0.0|              0.81|                 0.0|
|    25%|              1.0|               6.5|               0.0|               0.0|               0.0|              11.3|                 2.5|
|    50%|             1.65|               9.5|               0.5|              1.95|               0.0|             14.76|                 2.5|
|    75%|             3.05|              14.5|               2.5|              2.96|               0.0|             20.75|                 2.5|
|    max|            831.8|             296.0|               7.0|             500.0|            921.06|             970.3|                 3.0|


### Thrid Preprocessing Round

There are some strange information, e.g. trip less than a miniute but customer payed a lot, therefore we need to find a pattern to solve the problem.

According to [Taxi Fare Calculator](https://www.taxi-calculator.com/taxi-fare-new-york-city/259), the minimum fare for a single trip is $2.5, therefore, remove all rows with fare_amount less than $2.5.

There is also a irregulation of travel time period, some dropoff date happends before pickup, therefore removed invalid records based on timestamp.

Based on [TLC](https://www1.nyc.gov/site/tlc/passengers/passenger-frequently-asked-questions.page) web site, the yellow cab only take 4 or 5 passengers, removed records with passenger number greater than 5.

TLC yello cab mainly operated in New York City, and seeking a pssenger (street hail), and the speed limits is 25 miles per hour in 10 main strees and some areas are limited with 45 miles per hour in [see here](https://newyork.cbslocal.com/2021/05/10/new-york-city-speed-limit-department-of-transportation-bill-de-blasio/).

Therefore, removed speed over 50 miles per hour (45 + 5, include some systematic bias), assume all yellow taxis strictly operated in new york city. 

Also, removed records of travel time greater than 180 minutes, it's quite impossible to spend more than 3 hours, days, weeks, even month to travel in new york city, these data are absolutely outliers.

And this causes the datasets lose some information like the travel_time may included with waiting time, or someone travel cross the state. 

According to [tripsavvy](https://www.tripsavvy.com/guide-to-tipping-in-new-york-city-4177115), it should tip about 10%-20% for cab drivers,

consider it may have some extreme cases, e.g. someone take taxi from wealth suburb and willing to pay hundred buck tips therefore, we removed data records have tips which more than twice fare_amount.

### Fourth Preprocessing Round

Split datetime column into seperate date and time attributes.

Change variable names with a better name.

Drop unused columns.

## Data Preprocessing on extra data

### Data preprocessing on taxi-zone data

Join taxi zone csv file content with cleaned taxi dataframe.

According to observation on taxi_zone_lookup.csv, there are some unknown value of pickup zone and drop off zone (zone 264, 256), hence remove records with all unknown zone.

### Data preprocessing on 2019 New York car collision data.

The original dataset is located at Google big query nypd_mv_collisions dataset.

The aim of this preprocessing is to convert the timestamp into date and hour columns, group by the borough, date and hour, and count number of collisions, it expects return a dataframe like this:


|      borough|collision date|collision hour|count|
|-------------|--------------|--------------|-----|
|STATEN ISLAND|    2019-01-01|            22|    1|
|        BRONX|    2019-01-01|            17|    2|
|       QUEENS|    2019-01-01|            23|    2|
|     BROOKLYN|    2019-01-01|             7|    1|
|       QUEENS|    2019-01-01|             3|    4|
|        BRONX|    2019-01-01|             7|    1|
|       QUEENS|    2019-01-01|            12|    6|
|     BROOKLYN|    2019-01-01|            13|    3|
|       QUEENS|    2019-01-01|            20|    3|
|        BRONX|    2019-01-01|            21|    1|
|STATEN ISLAND|    2019-01-01|            12|    1|
|     BROOKLYN|    2019-01-01|             3|    3|
|STATEN ISLAND|    2019-01-01|             1|    2|
|    MANHATTAN|    2019-01-01|            16|    2|
|     BROOKLYN|    2019-01-01|             4|    5|
|     BROOKLYN|    2019-01-01|            14|    4|
|    MANHATTAN|    2019-01-01|             1|    4|
|    MANHATTAN|    2019-01-01|            20|    4|
|STATEN ISLAND|    2019-01-01|             7|    1|
|     BROOKLYN|    2019-01-01|            18|    3|

Because it is hard to match the exact collision records with taxi records, hence use number of car accidents within an hour instead. 

### Data preprocessing on New York events record

The original dataset downloaded from https://data.cityofnewyork.us/api/views/bkfu-528j/rows.csv?accessType=DOWNLOAD

Select data within 2019 and group data by the borough and event hold time period, it expects return a dataframe like this:

|Event ID|         Start Date/Time|          End Date/Time|Event Borough|
|--------|------------------------|-----------------------|-------------|
|  442866|	01/04/2019 06:00:00 AM|	01/04/2019 11:30:00 PM|  	Brooklyn|
|  450000|	01/04/2019 10:00:00 PM|	01/04/2019 11:30:00 PM|	   Manhattan|
|  444360|	01/03/2019 12:00:00 AM|	01/03/2019 11:59:00 PM|	   Manhattan|
|  449086|	01/03/2019 11:00:00 AM|	01/03/2019 01:00:00 PM|	   Manhattan|
|  447731|	01/13/2019 08:00:00 AM|	01/13/2019 08:00:00 PM|	   Manhattan|

In the merge stage, the program will merged the dataset with taxi_df based on number of events start at that date.

### Data preprocessing on New York weather data

The weather data is obtain from

The data dictionary is availale [here]() and some key-value pairs for WT\* is list below

WT\*\* = Weather Type where \*\* has one of the following values:

01 = Fog, ice fog, or freezing fog (may include heavy fog)

02 = Heavy fog or heaving freezing fog (not always distinguished from fog)

03 = Thunder

04 = Ice pellets, sleet, snow pellets, or small hail

06 = Glaze or rime

08 = Smoke or haze

The precision of the weather data influenced by the measure station.

Therefore, drop unused column: WT04


## Data merge process
1. merged taxi zone information based on taxi_df pickup location and dropoff location ID
2. merged weather data based on taxi_df pickup date
3. merged number of events count based on taxi_df pickup date
4. merged number of car collision count based on taxi_df pickup date

## Cleaning Process Sumary

1. removed unknown vendor id 4
2. removed passenger count greater than 6
3. removed rate code 99
4. removed passenger count 0
5. removed all negative values
6. removed all null values
7. removed duplicated rows
8. removed extreme value (upper bound) of fare_amount based on z score
9. removed fare_amount less than 2.5 dollars
10. converted variable name: pickup_datetime -> pickup_dt, dropoff_datetime -> dropoff_dt
11. removed irregulate dropoff time
12. removed mtx_tax not equal to 0.5
13. removed improvement_surcharge not equal to 0.3
14. removed records that miles per hour greater than 50
15. removed records that travel time greater 120 minutes
16. removed tips are twice more than fare amount
17. joined taxi_zone information
18. dropoff PULocation and DOLocation
19. removed records unknown LocationID
20. groupby car collision data based on date and hour
21. drop taxi zones (NA and NV)
22. joined weather dateset based on taxi_df pickup_date
23. joined event dataset based on taxi_df pickup_date
24. droped event borough and event date columns
25. joined collision data based on collision date
26. created route (combination of pickup_borough and dropoff_borough)
26. dropoff pickup_borough, dropoff_borough
27. reordered columns for better vision experience

After preprocessing, the dataset should has a schema:

<details>
  <summary>Click to expand!</summary>
  
  root

     |-- VendorID: integer (nullable = true)

     |-- passenger_count: integer (nullable = true)

     |-- trip_distance: double (nullable = true)

     |-- RatecodeID: integer (nullable = true)

     |-- store_and_fwd_flag: string (nullable = true)

     |-- payment_type: integer (nullable = true)

     |-- fare_amount: double (nullable = true)

     |-- extra: double (nullable = true)

     |-- mta_tax: double (nullable = true)

     |-- tip_amount: double (nullable = true)

     |-- tolls_amount: double (nullable = true)

     |-- improvement_surcharge: double (nullable = true)

     |-- total_amount: double (nullable = true)

     |-- congestion_surcharge: double (nullable = true)

     |-- time_duration_minutes: double (nullable = true)

     |-- driving_speed_miles_per_hour: double (nullable = true)

     |-- pickup_date: string (nullable = true)

     |-- pickup_time: string (nullable = true)

     |-- dropoff_date: string (nullable = true)

     |-- dropoff_time: string (nullable = true)

     |-- tip_rate: double (nullable = true)

     |-- pickup_zone: string (nullable = true)

     |-- pickup_service_zone: string (nullable = true)

     |-- dropoff_zone: string (nullable = true)

     |-- dropoff_service_zone: string (nullable = true)

     |-- trip_datetime: string (nullable = true)

     |-- Precipitation: double (nullable = false)

     |-- Snow: double (nullable = false)

     |-- Snow depth: double (nullable = false)

     |-- TAVG: double (nullable = false)

     |-- TMAX: integer (nullable = true)

     |-- TMIN: integer (nullable = true)

     |-- WT01: double (nullable = false)

     |-- WT02: double (nullable = false)

     |-- WT03: double (nullable = false)

     |-- WT06: double (nullable = false)

     |-- WT08: double (nullable = false)

     |-- number_of_event: long (nullable = true)

     |-- number_of_collision: long (nullable = false)

     |-- route: string (nullable = true)
</details>



---

Author: Sunchuangyu Huang

Date: 07-08-2021