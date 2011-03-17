# -*- coding: utf-8 -*-
import json

from django.test import TestCase
from django.core.urlresolvers import reverse

from django.contrib.auth.models import User

class ViewTests(TestCase):
    fixtures = ['test_data.json',]

    def test_logged_in(self):
        self.client.login(username='TestUser', password='12345')
        response = self.client.get('/login/')
        self.assertEqual(json.loads(response.content)['user'], 1)

    def test_now_logged_in(self):
        response = self.client.get('/login/')
        self.assertTrue(response.context['form'])

    def test_log_in(self):
        response = self.client.post(
            '/login/',
            {
                'username' : 'TestUser',
                'password' : '12345',
            }
            )
        self.assertEqual(json.loads(response.content)['user']['id'], '2')
        self.assertEqual(json.loads(response.content).keys(), ['sessionid', 'user'])

    def test_log_in_fail(self):
        response = self.client.post(
            '/login/',
            {
                'username' : 'TestUserFAIL',
                'password' : '12345',
            }
            )
        self.assertEqual(json.loads(response.content)['status'], 401)
        self.assertEqual(json.loads(response.content).keys(), ['status', 'error'])

    def test_register(self):
        response = self.client.post(
            '/register/', {
                'username' : 'newuser',
                'password' : '12345',
                'email' : 'newuser@example.com'
            })

        self.assertEqual(response.status_code, 200)
        logged_in = self.client.login(username='newuser', password='12345')
        self.assertEqual(logged_in, True)
        self.assertEqual(json.loads(response.content)['user_id'], 6)

    def test_register_bad_email(self):
        response = self.client.post(
            '/register/', {
                'username' : 'newuser',
                'password' : '12345',
                'email' : 'newuserexample.com'
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['errors'], ['email',])


