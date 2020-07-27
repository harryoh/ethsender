# ETHSender

### Architure

![](https://i.pinimg.com/564x/5d/c0/39/5dc0396377a7754458edfb03e7d308f0.jpg)

* `Node Server`: 요청을 받아서 Worker에게 Job을 전달하고 DB와 연결하여 Transaction의 상태를 변경합니다. Port: `50080`
* `Redis`: Queue를 사용하기 위한 Cache Service입니다.
* `Transfer Worker`: Queue로 부터 이더를 전송할 정보를 받아서 Transaction을 생성하여 전송합니다.
* `Monitor Worker`: `Transfer Worker`가 생성하여 전송한 Transaction의 상태를 감시하여 Block화가 될 경우에 상태를 업데이트합니다.
* `arena`: Queue를 모니터링 하기 위한 오픈소스입니다.  http://<address>:4567로 접속할 수 있습니다.

### Docker 설치

**Docker Community Edition**과 **Docker Compose**를 설치합니다.
Centos에서 설치하는 방법은 다음 링크를 통해서 확인할 수 있습니다.

* docker-ce : [Install Docker Engine on CentOS | Docker Documentation](https://docs.docker.com/engine/install/centos/)
* docker-compose: [Install Docker Compose | Docker Documentation](https://docs.docker.com/compose/install/)

---
### DB 접속 권한

Docker Container에서 Host Machine에 있는 DB에 접속해야 하기때문에 Container의 IP대역을 지정해줍니다.

```sql
mysql -u root -p

GRANT ALL ON oneethernet.* to 'root'@'172.%' IDENTIFIED BY '패스워드입력' WITH GRANT OPTION;

FLUSH PRIVILEGES;
EXIT;
```

---
### Table 생성

기존에 있는 Table의 Schema에서 약간 수정 및 'modifiedAt'을 추가했습니다.

**wallet_send_list**

```
create table wallet_send_list
(
    no            int auto_increment comment 'Row' primary key,
    mb_id         varchar(20)   null comment '계정아이디',
    transfer_code varchar(50)   not null comment '키값',
    coin          varchar(10)   not null comment '보낼코인수량',
    from_address  varchar(42)   not null comment '보낸주소',
    to_address    varchar(42)   not null comment '받는주소',
    txid          varchar(100)  null comment '전송TX',
    memo          varchar(100),
    status        int default 0 not null comment '전송상태값',
    createdAt     datetime      not null comment '전송시간',
    modifiedAt    datetime      null comment '마지막수정시간',
    completedAt    datetime      null comment '완료시간'
)
    engine = MyISAM;

create index wallet_send_list_status_index
    on wallet_send_list (status);

create index wallet_send_list_txid_index
    on wallet_send_list (txid);

create index wallet_send_list_txid_status_index
    on wallet_send_list (txid, status);
```

---
### 외부에서 nodeserver 접속 차단

'nodeserver'로 접속하는 부분에 인증은 없습니다.
따라서 같은 컴퓨터에서 접속하는데에는 문제가 없지만 외부에서 접속할 경우에는 자칫 크게 위험할 수도 있습니다.
따라서 Host Machine에서는 접속이 가능하지만 외부 요청에는 접속할 수 없도록 `iptables`를 이용하여 막습니다.

```
yum install iptables-services

iptables -I DOCKER-USER -p tcp -m tcp --dport 50080 -j DROP
iptables -I DOCKER-USER -p tcp -s 172.0.0.0/8 --dport 50080 -j ACCEPT

iptables-save > /etc/sysconfig/iptables
systemctl restart iptables
```

---
### Source Code

```
.
├── README.md
├── arena.json
├── docker
│   ├── Dockerfile-monitorworker
│   ├── Dockerfile-nodeserver
│   └── Dockerfile-transferworker
├── docker-compose-dev.yaml
├── docker-compose.yaml
├── env.sample
├── monitorworker
│   ├── app.js
│   ├── environment.js
│   ├── package-lock.json
│   └── package.json
├── nodeserver
│   ├── environment.js
│   ├── package-lock.json
│   ├── package.json
│   └── server.js
└── transferworker
    ├── app.js
    ├── environment.js
    ├── package-lock.json
    └── package.json
```

---
### 환경설정

환경설정은 Root에 `.env`가 있고 각 Worker에 `environment.js`가 있습니다.
대부분의 설정은 `.env`의 값이 넘어가며 몇가지만 `environment.js`에만 존재하는데 크게 신경쓰지 않아도 될 설정입니다.

`env.sample `파일을 `.env` 로 복사합니다.

```
cp env.sampl.e .env
```

* `NODE_ENV`: 러닝환경. Ethereum endpoint가 달라진다. 추가 설정 가능
* `MYSQL_DB_HOST`: Docker Hostmachine의 IP로 설정. 기본값은 `172.17.0.1`
* `MYSQL_XXX`: 기타 DB 접속 설정
* `PRIVATE_KEY`: 사용할 Private Key
* `INFURA_ACCESS_TOKEN`: Infura Access Token

**.env** 예제

```
NODE_ENV=production

MYSQL_DB_HOST=172.17.0.1
MYSQL_DB_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=willsoft
MYSQL_DATABASE=oneethernet

PRIVATE_KEY=596F60A09716DEAFD8AB1D477CAFD28453C74A995ED46CCB046D0EC1903500AB
INFURA_ACCESS_TOKEN=adc0ff2dcc784f86a794b4ec72f73e42
```

`NODE_ENV` 가 `production`일 경우에는 Ethereum Endpoint가 **Mainnet**으로 지정됩니다. `development`일 경우는 **Ropsten** 으로 설정합니다.

---
### Docker

**빌드**

빌드를 하게 되면 Dockerfile을 이용해서 Container Image를 생성하게 됩니다.

```
docker-compose build
```

**실행**

실행하게 되면 생성된 Image나 다운로드 받은 Image를 이용하여 Container를 실행합니다. `-d` 옵션은 데몬형식으로 실행하는 부분입니다.

```
docker-compose up -d
```

**종료**

종료하게 되면 생성된 Container가 삭제됩니다. 이때 Container에 저장되었던 모든 데이터는 없어집니다.

```
docker-compose down
```

**시작**

중지된 Container들을 다시 시작합니다. `up`을 했을 경우에는 자동으로 시작이 되고 서버가 재부팅되더라도 다시 시작하게 됩니다.
`start`는 `stop`을 이용해서 중지되었을 경우에만 가능합니다.

```
docker-compose start
```

**중지**

시작된 Container를 중지합니다. 중지할 경우에는 Container는 삭제되지 않으므로 데이터는 삭제되지 않습니다.

```
docker-compose stop
```

**Log**

docker-compose를 데몬형식으로 실행할 경우에는 Log를 바로 콘솔에서 볼 수가 없습니다. 다음의 명령을 통해서 Log를 확인할 수가 있습니다.

```
docker-compose logs

docker-compose logs -f nodeserver
```

**도커확인**

Docker Container를 확인하고 싶을때 사용할 수 있습니다.

```
docker ps

docker ps -a
```

---
### Queue 확인

`RequestTX`와 `PendingTx` Queue 두개가 존재합니다. 이 Queue를 통해서 이더리움을 전송할 Job을 Worker에게 넘기고 감시할 Transaction을 넘깁니다.

이 Queue의 동작상황을 모니터링 할 수가 있습니다.

```
http://211.238.13.164:4567
```

---
### Node Server

기본 포트는 **50080**을 사용합니다.
이더리움을 전송할 데이터를 넘겨줍니다.

같은 컴퓨터에서만 접속할 수가 있어야합니다.

```
curl http://localhost:50080/api/tx
```

위와같이 서버에서 Console에서 실행하면 동작을 확인할 수가 있습니다.


이더리움을 전송하기 위해서는 다음의 API를 이용합니다.

* `POST` /api/transfer

```json
[
  {
    "dbid": "1",
    "fromAddress": "0x3DfA78f186D46821935C38De5956e2018bDD51Dc",
    "toAddress": "0x6e9E074d1e1652a911A8A461bB9Bd9895Ac3e2E5",
    "value": "0.01"
  },  {
    "dbid": "2",
    "fromAddress": "0x3DfA78f186D46821935C38De5956e2018bDD51Dc",
    "toAddress": "0xf1A214A2FADD7Ca7d0B1558F402D3dE1ce014ECF",
    "value": "0.01"
  },
  ...
]
```

console에서 테스트 하기위해서는

```bash
curl -L -v -d '[{"dbid":"1", "fromAddress":"0x3DfA78f186D46821935C38De5956e2018bDD51Dc", "toAddress":"0x6e9E074d1e1652a911A8A461bB9Bd9895Ac3e2E5", "value": "0.01"}, {"dbid":"2", "fromAddress":"0x3DfA78f186D46821935C38De5956e2018bDD51Dc", "toAddress":"0xf1A214A2FADD7Ca7d0B1558F402D3dE1ce014ECF", "value": "0.01"}]' -H "Accept: application/json" -H "Content-Type: application/json" http://localhost:50080/api/transfer
```

전송할 데이터는 이미 DB에 저장되어있어야합니다.
그리고 해당 `dbid`  값의 데이터가 txid가 없어야하며 status의 값이 0이여야합니다.

---
### Node Server API

실제로 사용할 API는 `api/transfer` 이며 다른 API들은 모두 Worker에서 내부적으로 사용하고 있습니다.

#### /api/tx
* GET: DB에 저장되어 있는 모든 내역 출력

#### /api/tx/pending
* GET: Pending중인 TX목록

#### /api/tx/error
* GET: 전송 오류난 목록

#### /api/tx/<txid>
* GET: Txid기준으로 저장되어 있는 내역 출력
* PUT: Txid기준으로 저장되어 있는 내역 수정

#### /api/transfer
* POST: 전송할 목록을 전달 - 이미 DB에 저장되어 있어야함.

---
**> 동작중인 시스템의 환경을 바꿔서 다시 시작**

1. 시스템 종료

    ```
    docker-compose down
    ```

2. `.env` 수정
	* NODE_ENV
	* MYSQL  정보
	* PRIVATE_KEY
	* INFURA_ACCESS_TOKEN

3. 시스템 시작

    ```
    docker-compose up -d
    ```
