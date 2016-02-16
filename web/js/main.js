'use strict';
var BattleshipsClass = function() {
    // events log management
    var debug = !!localStorage.getItem('debug'),
    // API's base URL
        baseUrl = 'http://battleships-api.dev.lekowski.pl/v1',
    // battle boards axis Y legend
        axisY = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    // battle boards axis X legend
        axisX = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    // keys after pushing which we type in chatbox (A-Z, 0-9, :,._+)
        chatboxKeysRanges = '48-57, 59, 65-90, 96-105, 110, 188-191, 219-222',
    // parse ranges
        chatboxKeys = [],
    // prevents focusing on chatbox (usually when pressing ctrl/alt + chatbox_key)
        chatboxFocusPrevent = false,
    // whether the game has started
        gameStarted = false,
    // whether the game has ended
        gameEnded = false,
    // whether player started the game
        playerStarted = false,
    // whether opponent started the game
        otherStarted = false,
    // @todo do I need those joined? (player is kinda always joined now)
    // whether opponent joined the game
        otherJoined = false,
    // prevents shooting
        shotInProgress = false,
    // player number 1 or 2
        playerNumber,
    // which player's turn is now
        whoseTurn = 0,
    // battle boards
        $battleground,
    // chat
        $chatbox,
    // currently displayed modal
        $currentModal = null,
    // authentication token
        apiKey = localStorage.getItem('apiKey'),
    // game Id
        gameId,
    // id of the last event retrieved from API
        lastIdEvents = 0,
    // updates AJAX object
        updateXHR = null,
    // true - updates are requested (updating ON), false - you can start requesting updates (updating OFF),
        updateExecute = false,
    // interval between update calls
        updateInterval = 3000,
    // setTimeout() return value when waiting update_interval for a new update call
        lastTimeout = null;

    this.run = function() {
        // default settings for AJAX calls
        $.ajaxSetup({
            dataType: 'json',
            contentType: 'application/json',
            processData: false,
            beforeSend: function(jqXHR, settings) {
                console.info('Loading START');
                if (debug) {
                    console.log('url: %s%s', baseUrl, settings.url);
                    console.log('payload: %s', settings.data);
                }
                settings.url = baseUrl + settings.url;
                settings.data = JSON.stringify(settings.data);
                if (apiKey) {
                    jqXHR.setRequestHeader('Authorization', 'Bearer ' + apiKey);
                }
            },
            complete: function(jqXHR, textStatus) {
                if (debug) {
                    console.log('textStatus: %s', textStatus);
                    console.log(jqXHR.responseJSON);
                }
                console.info('Loading STOP');
            },
            error: function(jqXHR, textStatus) {
                var response = jqXHR ? jqXHR.responseJSON : null;

                if (textStatus === 'abort') {
                    console.info('Request aborted');
                    return;
                }

                if (debug) {
                    showError(response ? response.message + ' (' + response.code + ')' : 'Unknown error occurred');
                }
                console.error(response, textStatus);
            },
            dataFilter: function(data, type) {
                return (type === 'json' && data === '') ? null : data;
            }
        });

        $battleground = $('div:gt(0) div:not(:first-child)', 'div.board');
        $battleground.board = function(index) {
            return index === 0 ? $battleground.slice(0, 100) : $battleground.slice(100);
        };

        $chatbox = $(':text', '#chatbox');
        // parse key range to array
        parseChatboxKeys();
        // when start typing and not focused on text field, focus to type on chatbox
        $(document).on({keydown: documentKeydownCallback, keyup: documentKeyupCallback});

        // board handling
        $battleground.on('click', battlegroundClickCallback);

        // send chat text
        $chatbox.on('keyup', chatboxKeyupCallback);

        // starting the game
        $('#start').on('click', startClickCallback);

        // updating player's name
        $('.name_update')
            .on('click', nameUpdateClickCallback)
            .siblings(':text')
            .on({keyup: nameUpdateTextKeyupCallback, blur: nameUpdateTextBlurCallback});

        // updates management
        $('#update').on('click', updateClickCallback);

        // what to display depends on debug mode status
        $('.debug').toggle(debug);

        // starts new game
        $('#new_game').on('click', newGameClickCallback);

        // shoot randomly
        $('#random_shot').on('click', randomShot);

        // set ships randomly
        $('#random_ships').on('click', {retry: 2}, randomShips);

        // log out (remove API key)
        $('#logout').on('click', logout);

        // prevent on focus on button (I don't like the style)
        $('button').on('click', function() {
            $(this).blur();
        });

        $('.modal').on('show.bs.modal', function() {
            $currentModal = $(this);
        }).on('hide.bs.modal', function() {
            $currentModal = null;
        });

        $(window).on('hashchange', onHashChange);

        setupWebsocket()
    };

    var ws;
    function setupWebsocket() {
        ab.Deferred = jQuery.Deferred;
        ws = new ab.Session('ws://192.168.1.234:8080', onOpen, onClose, {'skipSubprotocolCheck': true});

        function onOpen() {
            console.info('opened');
            setupUser().done(function() {
                $(window).triggerHandler('hashchange', {first: true});
            });
        }

        function onClose() {
            console.warn('WebSocket connection closed');
        }
    }

    /**
     * @param {String} type
     * @param {String|Number} [value]
     * @return {Object} Promise
     */
    function addEventWebsocket(type, value) {
        return callWebsocket(
            'games-' + gameId,
            '/games/' + gameId + '/events',
            'POST',
            {type: type, value: value}
        ).then(function(data) {
            return data['content'];
        });
    }

    /**
     * @param {String} subscription
     * @param {String} url
     * @param {String} method
     * @param {Object} [data]
     * @return {Object} Promise
     */
    function callWebsocket(subscription, url, method, data) {
        var headers = {'HTTP_ACCEPT': 'application/json', 'HTTP_AUTHORIZATION': 'Bearer ' + apiKey};

        if (data) {
            headers.CONTENT_TYPE = 'application/json';
        } else {
            data = null;
        }

        var wsMsg = {
            url: '/v1' + url,
            method: method,
            headers: headers,
            data: data
        };

        return ws.call(subscription, wsMsg).done(function(data) {
            console.info('data from WS', data);
        });
    }


    /**
     * @return {Object} Promise
     */
    function setupUser() {
        var userCreatedPromise = apiKey ? $.when() : showPrompt('Please enter your name');

        return userCreatedPromise
            .then(function(playerName) {
                progress.modal({title: 'Setting up user details', stages: [[10, 40], [60, 80], 100]});

                return apiKey ? $.when() : addUser(playerName);
            })
            .then(progress.updateStage)
            .then(getUser)
            .then(progress.updateStage)
            .fail(progress.error);
    }

    function onHashChange(event, data) {
        var hashInfo = location.hash.replace(/^#/, ''),
            resumeFunction = $.noop();

        // no need to do it after page load
        if (!data || !data.first) {
            $battleground.removeClass();
            gameEnded = false;
            setPlayerStarted(false, true);
            setPlayerStarted(false, false);
            setTurn(0);
            $('.board_menu:eq(1) span').css({fontWeight: ''});
        }

        // stop looking for updates when changing game - may try to get updates for a game before joining it
        if (updateExecute || !debug) {
            // (re)start AJAX calls for updates
            resumeFunction = function() {
                $('#update').triggerHandler('click');
            };

            // stop AJAX calls for updates
            if (updateExecute) {
                resumeFunction();
            }
        }

        if (hashInfo === 'new') {
            progress.modal({title: 'Creating new game', stages: [[20, 40], 100]});
            addGame().done(progress.updateStage, resumeFunction);
        } else if (hashInfo) {
            setupGame().done(resumeFunction);
        } else {
            progress.modal({title: 'Looking for available games', stages: [[20, 40], 100]});
            getAvailableGames()
                .done(progress.updateStage)
                .done(function(data) {
                    data = data['content'];
                    if (data.length === 0) {
                        location.hash = 'new';
                    }
                });
        }

        function setupGame() {
            gameId = parseInt(hashInfo);
            console.info('Game from hash (id: %d)', gameId);

            ws.subscribe('games-' + gameId, function(topic, data) {
                console.info('new event', topic, data);
                handleEvents([data]);
            });

            progress.modal({title: 'Loading game details', stages: [[0, 10], [30, 40], [60, 80], 100]});

            return getGame()
                .then(function(data) {
                    var key,
                        $field,
                        $board = $battleground.board(0);

                    data = data['content'];

                    playerNumber = data.playerNumber;

                    if (data.playerShips && data.playerShips.length > 0) {
                        for (key in data.playerShips) {
                            $field = getFieldByCoords(data.playerShips[key], $board);
                            $field.addClass('ship');
                        }

                        setPlayerStarted(true, true);
                    } else {
                        setPlayerStarted(false, true);
                    }

                    // @todo mark somehow available space or joined player name
                    $('.other_name').text(data.other ? data.other.name : 'Player 2');

                    progress.updateStage();

                    return data.player ? $.when() : joinGame();
                })
                .then(progress.updateStage)
                .then(getEvents)
                .then(progress.updateStage)
                .fail(progress.error);
        }
    }

    /**
     * @param {Boolean} hasStarted
     * @param {Boolean} isMe
     */
    function setPlayerStarted(hasStarted, isMe) {
        if (isMe) {
            playerStarted = hasStarted;
            $('#random_ships').prop('disabled', hasStarted).toggle(!hasStarted);
            $('#start').prop('disabled', hasStarted);
        } else {
            otherStarted = hasStarted;
        }

        gameStarted = playerStarted && otherStarted;
    }

    /**
     * @param {String} msg
     */
    function showError(msg) {
        var errorHtml = '<div class="alert alert-danger" role="alert">' + msg + '</div>';

        if ($currentModal) {
            $currentModal.data('hide', false).find('.modal-body').append(errorHtml);
        } else {
            $('#modal').modal({backdrop: false});
            $currentModal.find('.modal-body').html(errorHtml);
            $currentModal.find('.modal-title').html('Error occurred');
        }
    }

    /**
     * @param {String} msg
     * @param {Object} [data]
     * @return {Object} Promise
     */
    function showConfirm(msg, data) {
        var promise = $.Deferred(),
            $modal = $('#modal'),
            $modalFooter = $('<div class="modal-footer">'),
            $confirmMsg = $('<h4>'+ msg + '</h4>');

        $modal.find('.modal-body').addClass('bg-primary').html($confirmMsg);
        $modal.find('.modal-title').html('Confirm');

        $modalFooter.append('<button type="button" class="btn btn-danger">No</button>');
        $modalFooter.append('<button type="button" class="btn btn-success" data-confirmed="true">Yes</button>');

        $modal.find('.modal-content').append($modalFooter);

        $('button', $modal).on('click', function(event, hidden) {
            $modalFooter.remove();
            $confirmMsg.remove();
            $modal.find('.modal-body').removeClass('bg-primary');
            $modal.find('.modal-title').html('');

            // promise must resolve after removing title and before checking data 'hide'
            promise.resolve($(this).data('confirmed') === true, data);

            if (($modal.data('hide') !== false) && (hidden !== true)) {
                $modal.modal('hide');
            }
        });

        $modal.on('shown.bs.modal', function () {
            $('button:last', $modal).focus();
        });

        $modal.on('hide.bs.modal', function() {
            $('button:first', $modal).triggerHandler('click', true);
        });

        if ($currentModal) {
            $currentModal.modal('hide');
        }
        $modal.modal({backdrop: false});

        return promise;
    }

    /**
     * @param {String} msg
     * @return {Object} Promise
     */
    function showPrompt(msg) {
        var promise = $.Deferred(),
            $input = $('<input type="text" placeholder="'+ msg + '" class="form-control" />'),
            existingModal = !!$currentModal,
            $modal = existingModal ? $currentModal : $('#modal');

        if (existingModal) {
            $modal.data('hide', false).find('.modal-body').addClass('bg-primary').append($input);
            $input.focus();
            if ($modal.find('.modal-title').html() === '') {
                $modal.find('.modal-title').html(msg);
            }
        } else {
            $modal.on('shown.bs.modal', function() {
                $input.focus();
            }).modal({backdrop: false});
            $modal.find('.modal-body').addClass('bg-primary').html($input);
            $modal.find('.modal-title').html(msg);
        }

        $input.on('keyup', function(event) {
            // hide on Enter
            if (event.which === 13) {
                $modal.find('.modal-body').removeClass('bg-primary');

                promise.resolve($input.val());
                $input.remove();

                if (!existingModal || $modal.data('hide') === true) {
                    $modal.modal('hide');
                }
                $modal.data('hide', true);
            }
        });

        return promise;
    }

    /**
     * @param {String} msg
     * @return {Object} Promise
     */
    function showInfo(msg) {
        var promise = $.Deferred(),
            $infoMsg = $('<h4>'+ msg + '</h4>'),
            $modalFooter = $('<div class="modal-footer">'),
            existingModal = !!$currentModal,
            $modal = existingModal ? $currentModal : $('#modal'),
            $button = $('<button type="button" class="btn btn-primary">OK</button>');

        $modal.find('.modal-content').append($modalFooter.append($button));

        if (existingModal) {
            $modal.data('hide', false).find('.modal-body').addClass('bg-primary').append($infoMsg);
            $button.focus();
            if ($modal.find('.modal-title').html() === '') {
                $modal.find('.modal-title').html('Info');
            }
        } else {
            $modal.find('.modal-body').addClass('bg-primary').html($infoMsg);
            $modal.find('.modal-title').html('Info');
            $modal.on('shown.bs.modal', function () {
                $button.focus();
            }).modal({backdrop: false});
        }


        $button.on('click', function() {
            $modal.find('.modal-body').removeClass('bg-primary');
            $modalFooter.remove();
            $infoMsg.remove();

            if (!existingModal) {
                $modal.find('.modal-title').html('');
            }

            promise.resolve();

            if (!existingModal || $modal.data('hide') === true) {
                $modal.modal('hide');
            }
            $modal.data('hide', true);
        });

        $modal.on('hide.bs.modal', function() {
            $button.triggerHandler('click', true);
        });

        return promise;
    }

    /**
     * @return {Object} jqXHR
     */
    function getAvailableGames() {
        return callWebsocket(
            'games',
            '/games?available=true',
            'GET'
        ).done(function(data) {
            var $gameList, rowHtml, game, i;

            data = data['content'];
            if (data.length === 0) {
                return;
            }

            $gameList = $('<table class="table table-striped">');
            $gameList.append('<thead><tr><th>Player name</th><th>Game created</th><th>Action</th></tr></thead>');

            rowHtml = '<tbody>';

            rowHtml += '<tr class="info">';
            rowHtml += '<td>' + $('.player_name:first').text() + '</td>';
            rowHtml += '<td></td>';
            rowHtml += '<td><a href="#new" class="btn btn-info btn-xs">Create New</a></td>';
            rowHtml += '</tr>';

            for (i = 0; i < data.length; i++) {
                game = data[i];

                rowHtml += '<tr>';
                rowHtml += '<td>' + game.other.name + '</td>';
                rowHtml += '<td>' + formatDate(new Date(game.timestamp)) + '</td>';
                rowHtml += '<td><a href="#' + game.id + '" class="btn btn-success btn-xs">Join</a></td>';
                rowHtml += '</tr>';
            }

            rowHtml += '</tbody>';
            $gameList.append(rowHtml);

            if ($currentModal) {
                $currentModal.data('hide', false);
            } else {
                $('#modal').modal();
                $currentModal.find('.modal-title').html('Join a game or create a new one');
            }

            $('a', $gameList).on('click', function() {
                $gameList.remove();
                $currentModal.data('hide', true);
            });

            $currentModal.find('.modal-body').append($gameList);
        });

        return $.ajax({
            url: '/games?available=true',
            method: 'GET',
            success: function(data) {
                var $gameList, rowHtml, game, i;

                if (data.length === 0) {
                    return;
                }

                $gameList = $('<table class="table table-striped">');
                $gameList.append('<thead><tr><th>Player name</th><th>Game created</th><th>Action</th></tr></thead>');

                rowHtml = '<tbody>';

                rowHtml += '<tr class="info">';
                rowHtml += '<td>' + $('.player_name:first').text() + '</td>';
                rowHtml += '<td></td>';
                rowHtml += '<td><a href="#new" class="btn btn-info btn-xs">Create New</a></td>';
                rowHtml += '</tr>';

                for (i = 0; i < data.length; i++) {
                    game = data[i];

                    rowHtml += '<tr>';
                    rowHtml += '<td>' + game.other.name + '</td>';
                    rowHtml += '<td>' + formatDate(new Date(game.timestamp)) + '</td>';
                    rowHtml += '<td><a href="#' + game.id + '" class="btn btn-success btn-xs">Join</a></td>';
                    rowHtml += '</tr>';
                }

                rowHtml += '</tbody>';
                $gameList.append(rowHtml);

                if ($currentModal) {
                    $currentModal.data('hide', false);
                } else {
                    $('#modal').modal();
                    $currentModal.find('.modal-title').html('Join a game or create a new one');
                }

                $('a', $gameList).on('click', function() {
                    $gameList.remove();
                    $currentModal.data('hide', true);
                });

                $currentModal.find('.modal-body').append($gameList);
            }
        });
    }

    function battlegroundClickCallback() {
        var $field = $(this);

        // shoot if other board
        if ($battleground.index($field) >= 100) {
            shot($field);
            // on your board toggle ships only if not started yet
        } else if (!playerStarted) {
            $field.toggleClass('ship');
        }
    }

    function startClickCallback() {
        var $startButton = $(this),
            $board = $battleground.board(0),
            $randomShipsButton = $('#random_ships'),
            playerShips;

        if (gameStarted) {
            showError('You have already started the game');
            return false;
        }

        if (checkShips($board) === false) {
            showError('There is either not enough ships or they\'re set incorrectly');
            return false;
        }

        $startButton.addClass('active');
        $randomShipsButton.prop('disabled', true);

        playerShips = $board.filter('.ship').map(function() {
            return getCoords(this);
        }).toArray();

        // @todo move to a separate function
        callWebsocket(
            'games-' + gameId,
            '/games/' + gameId,
            'PATCH',
            {playerShips: playerShips}
        ).then(function() {
            setPlayerStarted(true, true);
            $startButton.removeClass('active');
            setTurn(gameStarted && playerNumber === 1 ? 0 : 1);
        }).fail(function() {
            $randomShipsButton.prop('disabled', false);
        });
        return;

        $.ajax({
            url: '/games/' + gameId,
            method: 'PATCH',
            data: {playerShips: playerShips}
        }).then(function() {
            setPlayerStarted(true, true);
            $startButton.removeClass('active');
            setTurn(gameStarted && playerNumber === 1 ? 0 : 1);
        }).fail(function() {
            $randomShipsButton.prop('disabled', false);
        });
    }

    /**
     * @return {Object} jqXHR
     */
    function getUser() {
        var userId = JSON.parse(atob(apiKey.split('.')[1])).id;

        return callWebsocket(
            'users=' + userId,
            '/users/' + userId,
            'GET'
        ).done(function(data) {
            $('.player_name').text(data['content'].name);
        });

        return $.ajax({
            url: '/users/' + userId,
            method: 'GET',
            success: function(data) {
                $('.player_name').text(data.name);
            }
        });
    }

    /**
     * @param {String} name
     * @return {Object} jqXHR
     */
    function addUser(name) {
        return callWebsocket(
            'users',
            '/users',
            'POST',
            {name: name}
        ).then(function(data) {
            console.info('addUser data', data);
            var userId = parseInt(data.headers.location[0].match(/\d+$/)[0]);

            apiKey = data.headers['api-key'][0];
            localStorage.setItem('apiKey', apiKey);
            console.info('User created (id, apiKey)', userId, apiKey);

            return data;
        });

        return $.ajax({
            url: '/users',
            method: 'POST',
            data: {name: name},
            success: function(data, textStatus, jqXHR) {
                var userId = parseInt(jqXHR.getResponseHeader('Location').match(/\d+$/)[0]);

                apiKey = jqXHR.getResponseHeader('Api-Key');
                localStorage.setItem('apiKey', apiKey);
                console.info('User created (id, apiKey)', userId, apiKey);
            }
        });
    }

    /**
     * @param {String} type
     * @param {String|Number} [value]
     * @return {Object} jqXHR
     */
    function addEvent(type, value) {
        return addEventWebsocket(type, value);

        return $.ajax({
            url: '/games/' + gameId + '/events',
            method: 'POST',
            data: {type: type, value: value}
        });
    }

    /**
     * @return {Object} jqXHR
     */
    function addGame() {
        return callWebsocket(
            'games',
            '/games',
            'POST'
        ).done(function(data) {
            // @todo DRY
            var newGameId = parseInt(data.headers.location[0].match(/\d+$/)[0]);

            console.info('Game created (%d)', newGameId);
            if (otherJoined || playerNumber === 2) {
                addEvent('new_game', newGameId);
                console.info('Other player invited to the new game', newGameId);
            }

            gameId = newGameId;
            location.hash = gameId;
        });
        return $.ajax({
            url: '/games',
            method: 'POST',
            success: function(data, textStatus, jqXHR) {
                // @todo DRY
                var newGameId = parseInt(jqXHR.getResponseHeader('Location').match(/\d+$/)[0]);

                console.info('Game created (%d)', newGameId);
                if (otherJoined || playerNumber === 2) {
                    addEvent('new_game', newGameId);
                    console.info('Other player invited to the new game', newGameId);
                }

                gameId = newGameId;
                location.hash = gameId;
            }
        });
    }

    /**
     * @return {Object} jqXHR
     */
    function joinGame() {
        return callWebsocket(
            'games-' + gameId,
            '/games/' + gameId,
            'PATCH',
            {joinGame: true}
        );
        return $.ajax({
            url: '/games/' + gameId,
            method: 'PATCH',
            data: {joinGame: true},
            success: function() {
                console.info('Joined game (%d)', gameId);
            }
        });
    }

    /**
     * @return {Object} jqXHR
     */
    function getGame() {
        return callWebsocket(
            'games-' + gameId,
            '/games/' + gameId,
            'GET'
        );
        return $.ajax({
            url: '/games/' + gameId,
            method: 'GET'
        });
    }

    /**
     * @param {Object} [data]
     * @return {Object} jqXHR
     */
    function getEvents(data) {
        var filters = data ? '?' + $.param(data) : '';

        return callWebsocket(
            'games-' + gameId,
            '/games/' + gameId + '/events',
            'GET'
        ).done(function(data) {
            handleEvents(data['content']);
            checkGameEnd();
        });
        return $.ajax({
            url: '/games/' + gameId + '/events' + filters,
            method: 'GET',
            success: function(data) {
                handleEvents(data);
                checkGameEnd();
            }
        });
    }

    function updateClickCallback() {
        updateExecute = !updateExecute;

        if (updateExecute) {
            runUpdates();
        } else {
            stopUpdates();
        }

        $(this).toggleClass('active', updateExecute);
    }

    function runUpdates() {
        if (updateExecute !== true) {
            return;
        }

        updateXHR = getEvents({gt: lastIdEvents, player: (playerNumber === 1 ? 2 : 1)}).done(function() {
            if (updateExecute !== false) {
                lastTimeout = setTimeout(runUpdates, updateInterval);
            }
        });
    }

    function stopUpdates() {
        updateExecute = false;
        updateXHR.abort();
        clearTimeout(lastTimeout);
    }

    function handleEvents(events) {
        var i,
            event,
            shotResult,
            lastShot,
            position,
            $field,
            boardNumber;

        for (i = 0; i < events.length; i++) {
            event = events[i];

            console.log('event type `%s` and value `%s` for player `%s`', event.type, event.value, event.player);
            switch (event.type) {
                case 'name_update':
                    if (event.player !== playerNumber) {
                        $('.other_name').text(event.value);
                    }
                    break;

                case 'start_game':
                    setPlayerStarted(true, event.player === playerNumber);
                    // @todo figure out how to show turns when player needs to set ships, waits for another player
                    setTurn(gameStarted && playerNumber === 1 ? 0 : 1);
                    break;

                case 'join_game':
                    if (event.player !== playerNumber) {
                        $('.board_menu:eq(1) span').css({fontWeight: 'bold'});
                        getGame().done(function(data) {
                            data = data['content'];
                            if (data.other) {
                                $('.other_name').text(data.other.name);
                                otherJoined = true;
                            } else {
                                showError('Expected to get other player name after joining the game :/');
                            }
                        });
                    }
                    break;

                case 'shot':
                    shotResult = event.value.split('|');
                    boardNumber = event.player === playerNumber ? 1 : 0;
                    $field = getFieldByCoords(shotResult[0], $battleground.board(boardNumber));
                    position = new PositionClass(getPosition($field), boardNumber);

                    markShot(position, shotResult[1]);
                    lastShot = {player: event.player, result: shotResult[1]};
                    break;

                case 'chat':
                    chatAppend(event.value, (event.player === playerNumber), event.timestamp);
                    break;

                case 'new_game':
                    if (event.player !== playerNumber) {
                        showConfirm('Do you want to join ' + $('.other_name:first').text() + ' in the new game?', event.value)
                            .done(function(confirmed, newGameId) {
                                if (confirmed) {
                                    location.hash = newGameId;
                                }
                            });
                    }
                    break;
            }

            lastIdEvents = event.id;
        }

        if (lastShot) {
            if (lastShot.result === 'sunk') {
                checkGameEnd();
            }

            // @todo from API playerNumber 1|2 while here 0|1
            // my turn either if other missed or I didn't miss (isMiss === isMe same as isNotMiss === isNotMe)
            setTurn((lastShot.result === 'miss') === (lastShot.player === playerNumber) ? 1 : 0);
        }
    }

    function chatboxKeyupCallback(event) {
        var text, commandMatch, $update;

        if (event.which !== 13) {
            return true;
        }

        text = $.trim($chatbox.val());

        if (text === '') {
            return true;
        }

        // \debug or \nodebug
        commandMatch = text.match(/^\\(no)?debug$/);
        if (commandMatch) {
            $update = $('#update');
            // \nodebug
            if (commandMatch[1]) {
                localStorage.removeItem('debug');
                debug = false;
                if (!updateExecute) {
                    $update.triggerHandler('click');
                }
            } else {
                localStorage.setItem('debug', true);
                debug = true;
            }

            $update.toggle(debug);
            $chatbox.val('');

            return true;
        }

        $chatbox.prop('disabled', true);
        addEvent('chat', text).done(function(data) {
            chatAppend(text, true, data.timestamp);
            $chatbox.val('').prop('disabled', false);
        });
    }

    function parseChatboxKeys() {
        var keysRanges = chatboxKeysRanges.split(','),
            range, i, j;

        for (i = 0; i < keysRanges.length; i++) {
            range = keysRanges[i].split('-');

            if (range.length == 1) {
                chatboxKeys.push(parseInt(range[0]));
            } else {
                for (j = range[0]; j <= range[1]; j++) {
                    chatboxKeys.push(parseInt(j));
                }
            }
        }
    }

    function documentKeydownCallback(event) {
        // if ctr, alt, or cmd (Mac) pressed
        if ($.inArray(event.which, [17, 18, 91]) !== -1) {
            chatboxFocusPrevent = true;
            return true;
        }

        if (chatboxFocusPrevent || $(event.target).is(':text') || ($.inArray(event.which, chatboxKeys) === -1)) {
            return true;
        }

        $chatbox.focus();
    }

    function documentKeyupCallback() {
        chatboxFocusPrevent = false;
    }

    function nameUpdateClickCallback() {
        var $name = $(this),
            $input = $name.siblings(':text');

        $input.val($name.text());
        $name.hide();
        $input.show().select();
    }

    function nameUpdateTextKeyupCallback(event) {
        var $input = $(this),
            newName;

        // if pressed ESC - leave the input, if ENTER - process, if other - do nothing
        if (event.which !== 13) {
            if (event.which === 27) {
                $input.blur();
            }

            return true;
        }

        newName = $input.val();
        // @todo find a better way for storing/getting userId

        callWebsocket(
            'users-' + JSON.parse(atob(apiKey.split('.')[1])).id,
            '/users/' + JSON.parse(atob(apiKey.split('.')[1])).id,
            'PATCH',
            {name: newName}
        ).then(function() {
            console.log({name: newName});
            $('.player_name').text(newName);
            $input.hide().siblings('span').show();
            addEvent('name_update', newName);
        });
        return;

        $.ajax({
            url: '/users/' + JSON.parse(atob(apiKey.split('.')[1])).id,
            method: 'PATCH',
            data: {name: newName},
            success: function() {
                console.log({name: newName});
                $('.player_name').text(newName);
                $input.hide().siblings('span').show();
                addEvent('name_update', newName);
            }
        });
    }

    function nameUpdateTextBlurCallback() {
        var $input = $(this);

        if ($input.has(':visible')) {
            $input.hide();
            $input.siblings('span').show();
        }
    }

    function newGameClickCallback() {
        var promise = gameEnded ? $.when(true) : showConfirm('Are you sure you want to quit the current game?');

        promise.done(function(confirmed) {
            if (confirmed) {
                location.hash = 'new';
            }
        });
    }

    function shot($field) {
        var logMsg = '';

        if ($field.is('.miss, .hit, .shot')) {
            console.log('You either already shot this field, or no ship could be there');
            return;
        }

        if (whoseTurn !== 0 || shotInProgress || !gameStarted) {
            $field.addClass('shot').find('i:visible').fadeOut('slow', function() {
                $(this).css('display', '');
                $field.removeClass('shot');
            });

            if (shotInProgress) {
                logMsg = 'Shot in progress - wait for the result first';
            } else if (!gameStarted) {
                logMsg = 'You can\'t shoot at the moment - game has not started';
            } else {
                logMsg = 'It\'s other player\'s turn';
            }

            console.info(logMsg);
            return;
        }

        shotInProgress = true;
        $field.addClass('shot');

        addEvent('shot', getCoords($field)).done(function(data) {
            var position = new PositionClass(getPosition($field), 1),
                shotResult = data.result;

            markShot(position, shotResult);

            if (shotResult === 'miss') {
                setTurn(findWaitingPlayer());
            }

            if (shotResult === 'sunk') {
                checkGameEnd();
            }

            shotInProgress = false;
            $field.removeClass('shot');
        });
    }

    /**
     * @param {Object} element
     * @return {String}
     */
    function getCoords(element) {
        var index = $battleground.index(element),
            indexes,
            coordY,
            coordX;

        indexes = indexToArray(index);

        coordY = axisY[ indexes[1] ];
        coordX = axisX[ indexes[0] ];

        return coordY + coordX;
    }

    /**
     * @param {String} coords
     * @param {Object} $board
     * @return {Object} DOM Element
     */
    function getFieldByCoords(coords, $board) {
        var positionY = $.inArray(coords.substr(0, 1), axisY),
            positionX = $.inArray(parseInt(coords.substr(1)), axisX),
        // parseInt('08') -> 0
            position = parseInt([positionX, positionY].join(''), 10);

        return $board.eq(position);
    }

    /**
     * @param {PositionClass} position
     * @param {string} shotResult
     * @param {Number} [direction]
     */
    function markShot(position, shotResult, direction) {
        var markClass = '',
            missedPositions = [],
            $closeField,
            i;

        switch (shotResult) {
            case 'miss':
                markClass = 'miss';
                missedPositions.push(position);
                break;

            case 'hit':
                markClass = 'hit';
                missedPositions = position.getCornerPositions();
                break;

            case 'sunk':
                markClass = 'hit';
                missedPositions = position.getSurroundingPositions();
                break;
        }

        for (i = 0; i < missedPositions.length; i++) {
            var missedPosition = missedPositions[i];
            if (missedPosition === null || (direction !== undefined && direction !== i)) {
                continue;
            }

            $closeField = missedPosition.getField();
            if ($closeField.hasClass('hit') && shotResult === 'sunk') {
                markShot(missedPosition, shotResult, i);
            } else {
                $closeField.addClass('miss');
            }
        }

        if (direction === undefined) {
            position.getField().addClass(markClass);
        }
    }

    /**
     * @param {PositionClass} position
     * @param {Number} [direction]
     * @return {Boolean}
     */
    function isSunk(position, direction) {
        var sidePositions = position.getSidePositions(),
            sidePosition,
            $sideField,
            i;

        // @DRY - same as in mark_shot
        for (i = 0; i < sidePositions.length; i++) {
            sidePosition = sidePositions[i];
            if (sidePosition === null || (direction !== undefined && direction !== i)) {
                continue;
            }

            $sideField = sidePosition.getField();
            if ($sideField.hasClass('hit')) {
                if (isSunk(sidePosition, i) === false) {
                    return false;
                }
            } else if ($sideField.hasClass('ship')) {
                return false;
            }
        }

        return true;
    }

    function checkGameEnd() {
        if (gameEnded) {
            return;
        }

        if ($battleground.board(0).filter('.hit').length >= 20) {
            showInfo($('.other_name:first').text() + ' won');
            gameEnded = true;
        } else if ($battleground.board(1).filter('.hit').length >= 20) {
            showInfo($('.player_name:first').text() + ' won');
            gameEnded = true;
        }
    }

    /**
     * @param {Number} player
     */
    function setTurn(player) {
        whoseTurn = player;
        $('.board_menu:eq(' + whoseTurn + ') span').addClass('turn');
        $('.board_menu:eq(' + findWaitingPlayer() + ') span').removeClass('turn');
    }

    /**
     * @return {Number}
     */
    function findWaitingPlayer() {
        return whoseTurn === 0 ? 1 : 0;
    }

    /**
     * @param {Object} $board
     * @return {Boolean}
     */
    function checkShips($board) {
        var shipsArray,
            shipsLength = 20,
            shipsTypes = {1:0, 2:0, 3:0, 4:0},
            directionMultipliers = [1, 10],
            topRightCorner,
            bottomRightCorner,
            borderIndex,
            borderDistance,
            index,
            key,
            idx,
            i, j, k;

        shipsArray = $board.filter('.ship').map(function() {
            return $board.index(this);
        }).toArray();
        if (shipsArray.length !== shipsLength) {
            console.log('incorrect number of masts', shipsArray);
            return false;
        }

        // check if no edge connection
        for (i = 0; i < shipsArray.length; i++) {
            idx = indexToArray(shipsArray[i]);

            if (idx[0] === 9) {
                continue;
            }

            topRightCorner = (idx[1] > 0) && ($.inArray(shipsArray[i] + 9, shipsArray) !== -1);
            bottomRightCorner = (idx[1] < 9) && ($.inArray(shipsArray[i] + 11, shipsArray) !== -1);

            if (topRightCorner || bottomRightCorner) {
                console.log('edge connection');
                return false;
            }
        }

        // check if there are the right types of ships
        for (i = 0; i < shipsArray.length; i++) {
            // we ignore masts which have already been marked as a part of a ship
            if (shipsArray[i] === null) {
                continue;
            }

            idx = indexToArray(shipsArray[i]);

            for (j = 0; j < directionMultipliers.length; j++) {
                borderIndex = parseInt(j) === 1 ? 0 : 1;
                borderDistance = parseInt(idx[borderIndex]);

                k = 1;
                // battleground border
                while (borderDistance + k <= 9) {
                    index = shipsArray[i] + (k * directionMultipliers[j]);
                    key = $.inArray(index, shipsArray);

                    // no more masts
                    if (key === -1) {
                        break;
                    }

                    shipsArray[key] = null;

                    // ship is too long
                    if (++k > 4) {
                        console.log('ship is too long');
                        return false;
                    }
                }

                // if not last direction check and only one (otherwise in both direction at least 1 mast would be found)
                if ((k === 1) && ((j + 1) !== directionMultipliers.length)) {
                    continue;
                }

                break; // either k > 1 (so ship found) or last loop
            }

            shipsTypes[k]++;
        }

        // strange way to check if ships_types === {1:4, 2:3, 3:2, 4:1}
        for (i in shipsTypes) {
            if (parseInt(i) + shipsTypes[i] !== 5) {
                console.log('incorrect number of ships of this type', shipsTypes);
                return false;
            }
        }

        return true;
    }

    function randomShot() {
        var index,
            $emptyFields = $battleground.board(1).not('.miss, .hit');

        // random from 0 to the amount of empty fields - 1 (because first's index is 0)
        index = Math.floor(Math.random() * $emptyFields.length);
        $emptyFields.eq(index).trigger('click');
    }

    function randomShips(event) {
        var orientations = [0, 1], // 0 - vertical, 1 - horizontal
            directionMultipliers = [1, 10],
            shipsTypes = {1:4, 2:3, 3:2, 4:1},
            $board = $battleground.board(0),
            numberOfShips,
            masts,
            orientation,
            $startFields,
            index,
            idx,
            j,
            k;

        if (gameStarted) {
            showError('You can\'t set ships - the game has already started');
            return false;
        }

        $board.filter('.ship').click();
        for (numberOfShips in shipsTypes) {
            masts = shipsTypes[numberOfShips];

            for (j = 0; j < numberOfShips; j++) {
                orientation = orientations[ Math.floor(Math.random() * orientations.length) ];
                markRestrictedStarts($board, masts, orientation);
                $startFields = $board.not('.restricted');

                index = Math.floor(Math.random() * $startFields.length);
                idx = $board.index( $startFields.eq(index) );
                for (k = 0; k < masts; k++) {
                    $board.eq(idx + k * directionMultipliers[orientation]).click();
                }
            }
        }

        if (checkShips($board) === false) {
            if (event.data && event.data.retry > 0) {
                $board.removeClass('ship');
                event.data.retry--;

                return randomShips(event);
            }

            return false;
        }

        $board.removeClass('restricted');

        return true;
    }

    function logout() {
        localStorage.removeItem('apiKey');
    }

    function markRestrictedStarts($board, masts, orientation) {
        var directionMultipliers = [1, 10],
            marks,
            i;

        marks = $board.filter('.ship').map(function() {
            var index = $board.index(this),
                idx = indexToArray(index),
                borderDistance = parseInt(idx[Number(!orientation)]),
                mark = [index],
                safeIndex,
                safeIdx,
                k;

            if (idx[0] < 9) {
                mark.push(index + 10);
                if (idx[1] < 9) {
                    mark.push(index + 11);
                }
                if (idx[1] > 0) {
                    mark.push(index + 9);
                }
            }

            if (idx[0] > 0) {
                mark.push(index - 10);
                if (idx[1] < 9) {
                    mark.push(index - 9);
                }
                if (idx[1] > 0) {
                    mark.push(index - 11);
                }
            }

            if (idx[1] < 9) {
                mark.push(index + 1);
            }

            if (idx[1] > 0) {
                mark.push(index - 1);
            }

            for (k = 2; (borderDistance - k >= 0) && (k <= masts); k++) {
                safeIndex = index - (k * directionMultipliers[orientation]);
                safeIdx = indexToArray(safeIndex);
                mark.push(safeIndex);

                if (safeIdx[orientation] > 0) {
                    mark.push(safeIndex - directionMultipliers[Number(!orientation)]);
                }
                if (safeIdx[orientation] < 9) {
                    mark.push(safeIndex + directionMultipliers[Number(!orientation)]);
                }
            }

            return mark;
        }).toArray();

        $board.removeClass('restricted');

        for (i = 0; i < marks.length; i++) {
            $board.eq(marks[i]).addClass('restricted');
        }

        if (orientation === 0) {
            $board.filter('div:nth-child(n+' + (13 - masts) + ')').addClass('restricted');
        } else {
            $board.slice((11 - masts) * 10).addClass('restricted');
        }
    }

    function chatAppend(text, isMe, timestamp) {
        var nameClass = isMe ? 'player_name' : 'other_name',
            name = $('.' + nameClass).first().text(),
            formattedDate = formatDate(new Date(timestamp)),
            $time = $('<span>').addClass('time').text('[' + formattedDate + '] '),
            $chatterName = $('<span>').addClass(nameClass).text(name),
            $name = $('<span>').addClass('name').append($chatterName).append(': '),
            $text = $('<span>').text(text),
            $chatRow = $('<p>').append($time).append($name).append($text),
            $chats = $('#chatbox').find('div.chats'),
            $times = $chats.find('.time'),
            timesLength = $times.length,
            timesIterator = timesLength - 1;

        // finding a place to put a new row into (in case if new updated chat is older than an existing one)
        for (timesIterator; timesIterator >= 0; timesIterator--) {
            if (($times.eq(timesIterator).text().replace(/\[|\]/g, '') <= formattedDate)) {
                break;
            }
        }

        if ((timesLength === 0) || (timesIterator === timesLength - 1)) {
            $chats.append($chatRow);
        } else {
            $chats.children('p').eq(timesIterator + 1).before($chatRow);
        }

        $chats.clearQueue().animate({
            scrollTop: $chats.children('p').height() * timesIterator
        }, 'slow');
    }

    /**
     * Convert: 1 -> [0,1], 12 -> [1,2], 167 -> [6,7]
     * @param {Number} index
     * @return Array
     */
    function indexToArray(index) {
        if (index >= 100) {
            index = index - 100;
        }

        return ((index < 10 ? '0' : '') + index).split('');
    }

    /**
     * @param {Object} $field
     * @returns {Array}
     */
    function getPosition($field) {
        var index = $battleground.index($field),
            indexes = indexToArray(index);

        return [parseInt(indexes[1]), parseInt(indexes[0])];
    }

    /**
     * @param {Date} date
     * @return {string}
     */
    function formatDate(date) {
        return date.getFullYear()
            + '-' + (date.getMonth() + 1 < 10 ? '0' : '') + (date.getMonth() + 1)
            + '-' + (date.getDate() < 10 ? '0' : '') + date.getDate()
            + ' ' + (date.getHours() < 10 ? '0' : '') + date.getHours()
            + ':' + (date.getMinutes() < 10 ? '0' : '') + date.getMinutes()
            + ':' + (date.getSeconds() < 10 ? '0' : '') + date.getSeconds();
    }

    var progress = (function () {
        var stages = [],
            timeout = 0,
            $progressBar = $('.progress-bar'),
            $progressModal = $('#progress-modal').modal({backdrop: false, show: false}),
            error = function() {
                clearTimeout(timeout);
                $progressBar.addClass('progress-bar-danger').removeClass('active');
            },
            modal = function(options) {
                if (options.stages) {
                    setStages(options.stages);
                }

                if (options.title) {
                    $progressModal.find('.modal-title').text(options.title);
                }

                $progressModal.modal(options);
            },
            setStages = function(newStages) {
                $progressBar.removeClass('progress-bar-success progress-bar-danger').addClass('active');
                stages = newStages;
                updateStage();
            },
            updateStage = function() {
                var stage = stages.shift();

                if ($.isArray(stage)) {
                    setCurrent(stage[0], stage[1]);
                } else if (stage === undefined) {
                    setCurrent(100);
                } else {
                    setCurrent(stage);
                }
            },
            setCurrent = function(current, max) {
                clearTimeout(timeout);
                var progressText = current + '%';

                $progressBar.width(progressText).text(progressText);

                if (current === 100) {
                    $progressBar.addClass('progress-bar-success').removeClass('active');
                    timeout = setTimeout(function() {
                        if ($progressModal.data('hide') !== false) {
                            $progressModal.modal('hide');
                        }
                    }, 500);
                } else if (max && (max > current)) {
                    timeout = setTimeout(function() {
                        setCurrent(current + 1, max);
                    }, 300);
                }
            };

        return {
            error: error,
            modal: modal,
            setCurrent: setCurrent,
            setStages: setStages,
            updateStage: updateStage
        };
    })();

    /**
     * @param {Array} position
     * @param {Number} boardNumber
     * @constructor
     */
    var PositionClass = function(position, boardNumber) {

        this.getField = function() {
            // parseInt('08') -> 0
            var index = parseInt([position[1], position[0]].join(''), 10);

            return $battleground.board(boardNumber).eq(index);
        };

        this.getPositionY = function() {
            return position[0];
        };

        this.getPositionX = function() {
            return position[1];
        };

        this.getLeftPosition = function() {
            return position[1] > 0 ? new PositionClass([position[0], position[1] - 1], boardNumber) : null;
        };

        this.getRightPosition = function() {
            return position[1] < 9 ? new PositionClass([position[0], position[1] + 1], boardNumber) : null;
        };

        this.getTopPosition = function() {
            return position[0] > 0 ? new PositionClass([position[0] - 1, position[1]], boardNumber) : null;
        };

        this.getBottomPosition = function() {
            return position[0] < 9 ? new PositionClass([position[0] + 1, position[1]], boardNumber) : null;
        };

        this.getLeftTopPosition = function() {
            return (position[0] > 0 && position[1] > 0) ? new PositionClass([position[0] - 1, position[1] - 1], boardNumber) : null;
        };

        this.getRightTopPosition = function() {
            return (position[0] > 0 && position[1] < 9) ? new PositionClass([position[0] - 1, position[1] + 1], boardNumber) : null;
        };

        this.getLeftBottomPosition = function() {
            return (position[0] < 9 && position[1] > 0) ? new PositionClass([position[0] + 1, position[1] - 1], boardNumber) : null;
        };

        this.getRightBottomPosition = function() {
            return (position[0] < 9 && position[1] < 9) ? new PositionClass([position[0] + 1, position[1] + 1], boardNumber) : null;
        };

        this.getSurroundingPositions = function() {
            return [
                this.getLeftPosition(),
                this.getRightPosition(),
                this.getTopPosition(),
                this.getBottomPosition(),
                this.getLeftTopPosition(),
                this.getRightTopPosition(),
                this.getLeftBottomPosition(),
                this.getRightBottomPosition()
            ];
        };

        this.getSidePositions = function() {
            return [
                this.getLeftPosition(),
                this.getRightPosition(),
                this.getTopPosition(),
                this.getBottomPosition()
            ];
        };

        this.getCornerPositions = function() {
            return [
                this.getLeftTopPosition(),
                this.getRightTopPosition(),
                this.getLeftBottomPosition(),
                this.getRightBottomPosition()
            ];
        };
    };
};

$(function() {
    var Battleships = new BattleshipsClass();
    Battleships.run();
});
