import {AfterViewInit, Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {HttpClient, HttpErrorResponse, HttpParams} from '@angular/common/http';
import {BehaviorSubject, of} from 'rxjs';
import {catchError, delay, filter, flatMap, groupBy, map, mergeMap, switchMap, tap, toArray} from 'rxjs/operators';
import * as L from 'leaflet';
import * as Highcharts from 'highcharts';

import * as Exporting from 'highcharts/modules/exporting';
import {environment} from '../environments/environment';

// @ts-ignore
Exporting(Highcharts);

interface Device {
  lat: number;
  long: number;
  device: string;
  timestamp: Date;
  histories?: Device[];
  marker?: L.Marker;
  chart?: Highcharts.Chart;

  [name: string]: any;
}

interface DeviceMap {
  [name: string]: Device;
}

interface PopupEvent {
  source: L.popup;
  target: Device;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, AfterViewInit {
  title = 'crowd-sensor-cloud-web';
  @ViewChild('map')
  mapElement: ElementRef;
  @ViewChild('map')
  chartElement: ElementRef;
  map: L.Map;

  bounds = new BehaviorSubject<L.LatLngBounds>(undefined);
  devices = {};
  iotMarker: L.icon;

  constructor(private http: HttpClient) {
    this.iotMarker = L.icon({
      iconUrl: './assets/icons8-iot-sensor-50.png',
      iconSize: [25, 25],
    });
  }

  ngOnInit(): void {
    this.map = L.map(this.mapElement.nativeElement, {
      layers: [
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        })
      ]
    });
    this.map.on('locationfound', (e) => this.onLocationFound(e));
    this.bounds.pipe(
      filter(bound => !!bound),
      map(bound => new HttpParams().set(
        'ne', `${bound._northEast.lat},${bound._northEast.lng}`
        ).set(
        'sw', `${bound._southWest.lat},${bound._southWest.lng}`
        ).set(
        // 5분 단위로 캐쉬하도록 계산
        't', `${Math.floor(new Date().getTime() / (5 * 60 * 1000)) * 5 * 60 * 1000}`)
      ),
      switchMap(param => this.http.get('/device', {
        params: param,
        headers: {
          'x-api-key': environment.x_api_key
        }
      }).pipe(
        catchError((err) => {
          if (err instanceof HttpErrorResponse) {
            return of(err.error);
          }
          return of({
            status: 'error',
            error: '에러',
          });
        }),
      )),
      filter(resp => resp.status !== 'error'),
      flatMap(resp => resp.results),
      filter((item: Device) => {
        if (!this.devices[item.device]) {
          this.devices[item.device] = item;
        } else if (item.timestamp > this.devices[item.device].timestamp) {
          if (this.devices[item.device].marker) {
            this.devices[item.device].marker.remove();
          }
          this.devices[item.device] = item;
        } else {
          return false;
        }
        return true;
      }),
      tap((item: Device) => this.onAddMarker(item))
    ).subscribe();
  }

  ngAfterViewInit(): void {
    this.map.locate({setView: true, maxZoom: 17});
    this.map.on('moveend', (e) => this.onMoveEnd(e));
  }

  onLocationFound(event) {
    const radius = event.accuracy / 2;
    // L.marker(event.latlng).addTo(this.map)
    //   .bindPopup('이 곳에서' + radius + ' 미터 이내에 있습니다.').openPopup();
    L.circle(event.latlng, radius).addTo(this.map);
    this.map.setView(event.latlng, 15);
  }

  onMoveEnd(event) {
    this.bounds.next(this.map.getBounds());
  }

  onAddMarker(item: Device) {
    const chartElement = document.createElement('div');
    chartElement.style.width = '100%';
    chartElement.style.minWidth = '300px';
    chartElement.style.minHeight = '300px';
    chartElement.style.maxWidth = '300px';
    chartElement.style.maxHeight = '300px';
    item.marker = L.marker([item.lat, item.long]).addTo(this.map).bindPopup(chartElement);
    item.marker.on('popupopen', (e) => this.onShowChart({
      source: e,
      target: item,
    }, chartElement));
  }

  onShowChart(event: PopupEvent, container) {
    const chart = event.target.chart = Highcharts.chart(container, {
      chart: {
        type: 'spline',
        scrollablePlotArea: {
          minWidth: 300,
        },
        events: {
          load: () => of(undefined).pipe(
            delay(10),
            tap(() => event.target.basetime = Math.floor((new Date().getTime() - 150 * 60 * 1000) / (60 * 60 * 1000)) * 60 * 60 * 1000),
            tap(() => event.target.endtime = undefined),
            tap(() => this.onLoadSensorData(chart, event.target))
          ).subscribe()
        }
      },

      title: {
        text: `${event.target.device}`
      },

      subtitle: {
        text: '최근 3시간의 측정자료'
      },

      xAxis: {
        type: 'datetime',
        title: {
          text: '시간',
        },
      },
      yAxis: [{ // left y axis
        title: {
          text: ''
        },
        labels: {
          format: '{value:.,0f}°C',
          enabled: false,
        },
      }, {
        gridLineWidth: 0,
        title: {
          text: ''
        },
        labels: {
          format: '{value:.,0f}%',
          enabled: false,
        },
      }, { // right y axis
        gridLineWidth: 0,
        opposite: true,
        title: {
          text: ''
        },
        labels: {
          format: '{value:.,0f}㎍/m³',
          enabled: false,
        },
      }, {
        gridLineWidth: 0,
        opposite: true,
        title: {
          text: ''
        },
        labels: {
          format: '{value:.,0f}㎍/m³',
          enabled: false,
        },
      }],

      legend: {
        align: 'left',
        verticalAlign: 'top',
        borderWidth: 0
      },

      tooltip: {
        shared: true,
        crosshairs: true
      },

      plotOptions: {
        series: {
          cursor: 'pointer',
          point: {
            events: {}
          },
          marker: {
            lineWidth: 1
          }
        }
      },

      series: [{
        name: 'Temperature',
        type: 'spline',
        yAxis: 0,
        tooltip: {
          valueSuffix: '°C',
        },
        data: []
      }, {
        name: 'Humidity',
        type: 'spline',
        yAxis: 1,
        tooltip: {
          valueSuffix: '%',
        },
        data: []
      }, {
        name: 'PM 10',
        type: 'spline',
        yAxis: 2,
        tooltip: {
          valueSuffix: '㎍/m³',
        },
        data: []
      }, {
        name: 'PM 2.5',
        type: 'spline',
        yAxis: 3,
        tooltip: {
          valueSuffix: '㎍/m³',
        },
        data: []
      }]
    });
    chart.renderer.button('이전', 10, 30, () => {
      const device: Device = event.target;
      device.endtime = device.basetime;
      device.basetime = device.basetime - 3 * 60 * 60 * 1000;
      const hours = Math.round((new Date().getTime() - device.basetime) / 3600000);
      this.onLoadSensorData(chart, event.target);
      chart.setSubtitle({
        text: `${hours}시간 전 측정자료`
      });
    }, null).add();
  }

  onLoadSensorData(chart: Highcharts.Chart, target: Device) {
    let param = new HttpParams().set(
      'device', target.device,
    ).set(
      'start', `${target.basetime}`
    ).set(
      'count', '500'
    ).set(
      // 5분 단위로 캐쉬하도록 계산
      't', `${Math.floor(new Date().getTime() / (5 * 60 * 1000)) * 5 * 60 * 1000}`
    );
    if (target.endtime) {
      param = param.set('end', `${target.endtime}`);
    }
    this.http.get('/air', {
      params: param,
      headers: {
        'x-api-key': environment.x_api_key
      }
    }).pipe(
      flatMap((data: any) => data.results),
      flatMap((item: any) => [
        {key: 0, value: item.temperature, time: item.timestamp + 9 * 60 * 60 * 1000},
        {key: 1, value: item.humidity, time: item.timestamp + 9 * 60 * 60 * 1000},
        {key: 2, value: item.pm10, time: item.timestamp + 9 * 60 * 60 * 1000},
        {key: 3, value: item.pm25, time: item.timestamp + 9 * 60 * 60 * 1000},
      ]),
      groupBy(item => item.key),
      mergeMap(group => group.pipe(
        map(item => [item.time, item.value]),
        toArray(),
        tap(data => chart.series[group.key].setData(data)),
      )),
      catchError(() => {
        const label = chart.renderer.label('데이터 없음', 120, 130);
        return of(label).pipe(
          tap(item => item.add()),
          delay(2000),
          tap(item => item.destroy()),
        );
      }),
    ).subscribe();
  }
}
