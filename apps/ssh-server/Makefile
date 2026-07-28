.PHONY: build build-pi run clean

BINARY = ssh-server

build:
	go build -o $(BINARY) .

# Raspberry Pi Zero W = ARMv6
build-pi:
	GOOS=linux GOARCH=arm GOARM=6 go build -o $(BINARY) .

run:
	PORT=2222 go run .

clean:
	rm -f $(BINARY)
